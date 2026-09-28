import numpy as np

from bmp_hsn.scoring import SOURCE_WEIGHTS, score_nearest_text


def unit(values):
    array = np.array(values, dtype=np.float32)
    return array / np.linalg.norm(array)


def test_takes_the_heading_of_the_single_closest_text():
    corpus = np.vstack([unit([1, 0, 0]), unit([0, 1, 0])])
    result = score_nearest_text(
        np.vstack([unit([0.95, 0.1, 0])]),
        corpus,
        ["7320", "7307"],
        ["lexicon", "lexicon"],
        ["7320"],
    )
    assert result.top1 == ["7320"]
    assert result.accuracy == 1.0


def test_one_curated_term_is_not_averaged_away_by_its_headings_tariff_rows():
    # The reason this exists rather than class centroids: 7320's two curated terms lose to its
    # eleven rows of tariff prose under averaging, and a disc-spring washer lands on 7318.
    corpus = np.vstack([unit([1, 0, 0])] + [unit([0.1, 1, 0])] * 20)
    headings = ["7320"] + ["7318"] * 20
    sources = ["lexicon"] + ["tariff"] * 20

    result = score_nearest_text(np.vstack([unit([1, 0, 0])]), corpus, headings, sources, ["7320"])
    assert result.top1 == ["7320"]


def test_tariff_text_is_weighted_below_a_curated_term():
    # "STOCKINGS, SOCKS, SOCKETTES" outscored the curated "socket" on raw cosine; the weighting is
    # what flips it back. 0.99 * 0.85 < 0.90 * 1.0.
    corpus = np.vstack([unit([1, 0, 0]), unit([0.9, 0.436, 0])])
    result = score_nearest_text(
        np.vstack([unit([1, 0, 0])]),
        corpus,
        ["6217", "7307"],
        ["tariff", "lexicon"],
        ["7307"],
    )
    assert result.top1 == ["7307"]


def test_several_texts_of_one_heading_count_as_agreement_not_ambiguity():
    # Margin must be measured against a DIFFERENT heading, or two near-identical texts of the same
    # class would read as a coin toss.
    corpus = np.vstack([unit([1, 0, 0]), unit([0.99, 0.14, 0]), unit([0, 1, 0])])
    result = score_nearest_text(
        np.vstack([unit([1, 0, 0])]),
        corpus,
        ["7320", "7320", "7307"],
        ["lexicon", "tariff", "tariff"],
        ["7320"],
    )
    assert result.margins[0] > 0.5


def test_weights_match_the_typescript_side():
    # These two constants have to agree or the trainer reports an accuracy the server never delivers.
    assert SOURCE_WEIGHTS == {"lexicon": 1.0, "tariff": 0.85}


def test_an_unknown_source_keeps_full_weight():
    corpus = np.vstack([unit([1, 0, 0])])
    result = score_nearest_text(
        np.vstack([unit([1, 0, 0])]), corpus, ["7320"], ["something-new"], ["7320"]
    )
    assert result.accuracy == 1.0
