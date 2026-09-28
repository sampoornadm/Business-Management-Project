"""Turns the labelled corpus into (anchor, positive) pairs and into class-distinct batches.

MultipleNegativesRankingLoss pulls a pair together and pushes it away from every other row in the
batch. Two things follow, and both are load-bearing:

1. What a pair *contains* is the whole lesson. Pairing two tariff phrasings teaches CBIC's register
   against itself, which the model already handles. Pairing a curated trade term against tariff text
   is the lesson that matters — nothing in heading 7320's official text says "disc spring".
2. What a *batch* contains decides what counts as a negative. Two pairs from the same heading in one
   batch tell the model that 7320's text is a negative for 7320.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from bmp_hsn.data import Example

DEFAULT_MAX_PER_CLASS = 8


@dataclass(frozen=True)
class Pair:
    anchor: str
    positive: str
    heading: str


def build_pairs(
    examples: list[Example],
    max_per_class: int = DEFAULT_MAX_PER_CLASS,
    seed: int = 20260928,
) -> list[Pair]:
    """Same-heading text pairs, cross-register first, capped per class.

    The cap is not a performance concession: heading 8544 has 59 descendants and 7320 has 11, so
    uncapped, the negatives would be dominated by whichever headings the tariff happens to subdivide
    most finely rather than by what people actually buy.
    """
    by_heading: dict[str, list[Example]] = {}
    for example in examples:
        by_heading.setdefault(example.heading, []).append(example)

    rng = random.Random(seed)
    pairs: list[Pair] = []

    for heading in sorted(by_heading):
        group = by_heading[heading]
        curated = [e for e in group if e.source == "lexicon"]
        official = [e for e in group if e.source != "lexicon"]

        # Cross-register first: every curated term against every official phrasing of its class.
        candidates = [
            Pair(term.text, other.text, heading)
            for term in curated
            for other in official
            if term.text != other.text
        ]

        # Then same-register pairs, so classes with no curated vocabulary still train.
        same_register = [
            Pair(a.text, b.text, heading)
            for i, a in enumerate(official)
            for b in official[i + 1 :]
            if a.text != b.text
        ]
        rng.shuffle(same_register)
        candidates.extend(same_register)

        pairs.extend(candidates[:max_per_class])

    rng.shuffle(pairs)
    return pairs


def _pack(pairs: list[Pair], batch_size: int) -> tuple[list[list[Pair]], list[Pair]]:
    """Greedily fills batches from `pairs` in order, never repeating a heading within a batch.

    Returns the batches and whatever could not be placed, so a caller packing window by window can
    carry the remainder forward instead of dropping it.
    """
    remaining = list(pairs)
    batches: list[list[Pair]] = []

    while len(remaining) >= batch_size:
        batch: list[Pair] = []
        seen: set[str] = set()
        leftover: list[Pair] = []

        for pair in remaining:
            if len(batch) < batch_size and pair.heading not in seen:
                batch.append(pair)
                seen.add(pair.heading)
            else:
                leftover.append(pair)

        if len(batch) < batch_size:
            break
        batches.append(batch)
        remaining = leftover

    return batches, remaining


def build_batches(
    pairs: list[Pair],
    batch_size: int,
    seed: int = 20260928,
    group_by_length: bool = False,
) -> list[list[Pair]]:
    """Groups pairs into full batches in which every heading appears at most once.

    Pairs that cannot be placed without repeating a heading are dropped rather than forced in; with
    1,301 headings and several pairs each there is no shortage, and a clean negative is worth more
    than a slightly larger epoch.

    `group_by_length` additionally keeps each batch's texts a similar length. Every sequence in a
    batch is padded to the longest one in it and attention cost grows with the square of that
    length, so a single 829-token tariff row dragged into a batch of 20-token trade terms makes
    that whole step cost as much as its longest member. Measured here, ungrouped batches ran at
    ~25 s/step because essentially every batch contained something near the 128-token cap.
    """
    rng = random.Random(seed)

    if not group_by_length:
        shuffled = list(pairs)
        rng.shuffle(shuffled)
        return _pack(shuffled, batch_size)[0]

    # Sort into length order, cut into narrow chunks, then shuffle within each chunk so the model
    # still sees varied negatives rather than the same neighbours every epoch. Two batches wide is
    # deliberate: at eight the shuffle mixes the long tail back in with the short texts and the
    # padding saving disappears entirely.
    ordered = sorted(pairs, key=lambda p: max(len(p.anchor), len(p.positive)))
    window = batch_size * 2
    batches: list[list[Pair]] = []

    # Same-heading pairs tend to be the same length, so they sort next to each other — precisely
    # the pairs that cannot share a batch. Carrying each window's remainder into the next keeps
    # them in the epoch (at a slightly wider length spread) instead of silently discarding them.
    carried: list[Pair] = []
    for start in range(0, len(ordered), window):
        chunk = carried + ordered[start : start + window]
        rng.shuffle(chunk)
        packed, carried = _pack(chunk, batch_size)
        batches.extend(packed)

    if carried:
        rng.shuffle(carried)
        batches.extend(_pack(carried, batch_size)[0])

    # Batch order is shuffled too: left sorted, training would see every short batch before any
    # long one, which biases the optimiser's late steps toward long text.
    rng.shuffle(batches)
    return batches
