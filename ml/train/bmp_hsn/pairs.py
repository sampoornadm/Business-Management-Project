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


def build_batches(pairs: list[Pair], batch_size: int, seed: int = 20260928) -> list[list[Pair]]:
    """Groups pairs into full batches in which every heading appears at most once.

    Pairs that cannot be placed without repeating a heading are dropped rather than forced in; with
    1,301 headings and 8 pairs each there is no shortage, and a clean negative is worth more than a
    slightly larger epoch.
    """
    rng = random.Random(seed)
    remaining = list(pairs)
    rng.shuffle(remaining)

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

    return batches
