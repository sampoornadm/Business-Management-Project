from bmp_hsn.data import Example
from bmp_hsn.pairs import build_batches, build_pairs


def ex(text: str, heading: str, source: str = "tariff") -> Example:
    return Example(text=text, heading=heading, chapter=heading[:2], source=source, weight=1.0)


def test_a_class_with_a_single_example_yields_no_pair():
    # 1,301 classes and a minimum of one example each: a lone example has nothing to be pulled
    # toward. It still gets a prototype at inference, so dropping it here loses nothing.
    assert build_pairs([ex("LEAF-SPRINGS", "7320")]) == []


def test_pairs_only_texts_of_the_same_heading():
    pairs = build_pairs([ex("a", "7320"), ex("b", "7320"), ex("c", "7307"), ex("d", "7307")])
    for pair in pairs:
        assert {pair.anchor, pair.positive} in ({"a", "b"}, {"c", "d"})
        assert pair.heading == ("7320" if pair.anchor in {"a", "b"} else "7307")


def test_prefers_pairing_curated_trade_terms_with_tariff_text():
    # "disc spring" (what a purchase order says) against "HELICAL SPRINGS" (what CBIC says) is the
    # pair that teaches the vocabulary bridge. Two tariff phrasings of each other teach nothing new.
    examples = [
        ex("disc spring", "7320", source="lexicon"),
        ex("HELICAL SPRINGS", "7320"),
        ex("LEAF-SPRINGS", "7320"),
        ex("SPRING PINS", "7320"),
    ]
    pairs = build_pairs(examples, max_per_class=2)
    assert all(pair.anchor == "disc spring" for pair in pairs)


def test_caps_pairs_per_class_so_a_large_heading_cannot_swamp_a_small_one():
    big = [ex(f"t{i}", "7307") for i in range(100)]
    small = [ex("x", "7320"), ex("y", "7320")]
    pairs = build_pairs(big + small, max_per_class=5)
    assert sum(1 for p in pairs if p.heading == "7307") <= 5


def test_is_deterministic_for_a_given_seed():
    examples = [ex(f"t{i}", "7307") for i in range(20)]
    assert build_pairs(examples, seed=7) == build_pairs(examples, seed=7)


def test_never_pairs_a_text_with_itself():
    examples = [ex("same", "7320"), ex("same", "7320"), ex("other", "7320")]
    for pair in build_pairs(examples):
        assert pair.anchor != pair.positive


def test_batches_never_contain_the_same_heading_twice():
    # MultipleNegativesRankingLoss treats every other row in the batch as a negative. Two pairs from
    # heading 7320 in one batch means the model is told 7320's own text is a negative for 7320 —
    # training directly against the thing it is supposed to learn.
    examples = []
    for heading in ("7307", "7320", "7318", "3926"):
        examples += [ex(f"{heading}-a", heading), ex(f"{heading}-b", heading), ex(f"{heading}-c", heading)]

    for batch in build_batches(build_pairs(examples), batch_size=4):
        headings = [pair.heading for pair in batch]
        assert len(headings) == len(set(headings))


def test_batches_are_full_sized_and_cover_the_pairs():
    examples = []
    for i in range(20):
        heading = f"73{i:02d}"
        examples += [ex(f"{heading}-a", heading), ex(f"{heading}-b", heading)]

    pairs = build_pairs(examples)
    batches = build_batches(pairs, batch_size=5)
    assert all(len(batch) == 5 for batch in batches)
    assert sum(len(batch) for batch in batches) <= len(pairs)


def test_batching_is_deterministic_for_a_given_seed():
    examples = []
    for i in range(20):
        heading = f"73{i:02d}"
        examples += [ex(f"{heading}-a", heading), ex(f"{heading}-b", heading)]
    pairs = build_pairs(examples)
    assert build_batches(pairs, 5, seed=3) == build_batches(pairs, 5, seed=3)
