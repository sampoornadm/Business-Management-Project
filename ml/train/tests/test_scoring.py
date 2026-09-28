import numpy as np

from bmp_hsn.scoring import build_prototypes, normalise, score


def test_prototype_is_the_mean_direction_of_its_class():
    embeddings = np.array([[1.0, 0.0], [0.0, 1.0], [0.0, 1.0]], dtype=np.float32)
    prototypes, classes = build_prototypes(embeddings, ["7320", "7307", "7307"])

    assert classes == ["7307", "7320"]
    np.testing.assert_allclose(prototypes[0], [0.0, 1.0], atol=1e-6)
    np.testing.assert_allclose(prototypes[1], [1.0, 0.0], atol=1e-6)


def test_a_class_with_many_examples_does_not_outweigh_one_with_few():
    # 7307 has 200 tariff rows, 7320 has one curated term. Without re-normalising, 7307's prototype
    # would simply be a longer vector and would win on dot product regardless of direction.
    embeddings = np.array([[1.0, 0.0]] * 200 + [[0.0, 1.0]], dtype=np.float32)
    headings = ["7307"] * 200 + ["7320"]
    prototypes, classes = build_prototypes(embeddings, headings)

    assert np.allclose(np.linalg.norm(prototypes, axis=1), 1.0, atol=1e-6)

    query = np.array([[0.0, 1.0]], dtype=np.float32)
    result = score(query, prototypes, classes, ["7320"])
    assert result.top1 == ["7320"]


def test_scores_accuracy_top5_and_chapter_accuracy_separately():
    # Four unit directions; query matches class C exactly.
    prototypes = normalise(np.eye(4, dtype=np.float32))
    classes = ["7307", "7320", "7318", "8536"]
    query = np.array([[0.0, 0.0, 1.0, 0.0]], dtype=np.float32)

    result = score(query, prototypes, classes, ["7318"])
    assert result.accuracy == 1.0
    assert result.top5 == 1.0
    assert result.chapter_accuracy == 1.0
    assert result.n == 1


def test_chapter_accuracy_gives_credit_for_the_right_chapter_wrong_heading():
    prototypes = normalise(np.eye(2, dtype=np.float32))
    classes = ["7307", "7320"]
    query = np.array([[1.0, 0.0]], dtype=np.float32)

    result = score(query, prototypes, classes, ["7320"])
    assert result.accuracy == 0.0
    assert result.chapter_accuracy == 1.0  # both are chapter 73


def test_margin_is_top1_minus_top2_and_drives_abstention():
    # The 0.001-margin coin flip between 7320 and 7318 is exactly what abstention must catch, so the
    # margin has to be reported per item rather than only in aggregate.
    prototypes = normalise(np.array([[1.0, 0.0], [0.999, 0.045]], dtype=np.float32))
    classes = ["7320", "7318"]
    query = np.array([[1.0, 0.0]], dtype=np.float32)

    result = score(query, prototypes, classes, ["7320"])
    assert result.margins[0] < 0.01
    assert result.correct == [True]


def test_query_vectors_need_not_arrive_normalised():
    prototypes = normalise(np.eye(2, dtype=np.float32))
    query = np.array([[0.0, 7.5]], dtype=np.float32)

    result = score(query, prototypes, ["7307", "7320"], ["7320"])
    assert result.top1 == ["7320"]
