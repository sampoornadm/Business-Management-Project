"""Prototype-cosine classification and the metrics every run reports.

A class is represented by the mean of its training texts' embeddings, not by a softmax row. That is
what lets a heading with a single training example still be placed correctly, and what lets the user
add a heading to the lookup sheet without invalidating the model.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def normalise(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return matrix / np.maximum(norms, 1e-12)


def build_prototypes(embeddings: np.ndarray, headings: list[str]) -> tuple[np.ndarray, list[str]]:
    """Mean of each class's example vectors, re-normalised.

    The re-normalise is not cosmetic: heading 7307 has 200 tariff rows and 7320 has one curated
    term, so without it 7307's prototype is simply a longer vector and wins on dot product whatever
    direction the query points in.
    """
    classes = sorted(set(headings))
    index = {heading: i for i, heading in enumerate(classes)}
    sums = np.zeros((len(classes), embeddings.shape[1]), dtype=np.float32)
    counts = np.zeros(len(classes), dtype=np.float32)

    for vector, heading in zip(embeddings, headings):
        i = index[heading]
        sums[i] += vector
        counts[i] += 1.0

    return normalise(sums / np.maximum(counts, 1.0)[:, None]), classes


@dataclass
class Scored:
    accuracy: float
    top5: float
    chapter_accuracy: float
    n: int
    top1: list[str]
    margins: list[float]
    correct: list[bool]


def score(
    query_vectors: np.ndarray,
    prototypes: np.ndarray,
    classes: list[str],
    expected: list[str],
) -> Scored:
    return score_matrix(normalise(query_vectors) @ prototypes.T, classes, expected)


def score_matrix(similarity: np.ndarray, classes: list[str], expected: list[str]) -> Scored:
    """Metrics from an already-computed per-class score matrix (rows = items, columns = classes)."""
    ranked = np.argsort(-similarity, axis=1)

    top1: list[str] = []
    margins: list[float] = []
    correct: list[bool] = []
    hits5 = 0
    chapter_hits = 0

    for row, want in enumerate(expected):
        best = int(ranked[row, 0])
        got = classes[best]
        top1.append(got)
        correct.append(got == want)

        runner_up = float(similarity[row, ranked[row, 1]]) if len(classes) > 1 else 0.0
        margins.append(float(similarity[row, best]) - runner_up)

        if want in [classes[int(i)] for i in ranked[row, :5]]:
            hits5 += 1
        if got[:2] == want[:2]:
            chapter_hits += 1

    n = len(expected)
    return Scored(
        accuracy=sum(correct) / n if n else 0.0,
        top5=hits5 / n if n else 0.0,
        chapter_accuracy=chapter_hits / n if n else 0.0,
        n=n,
        top1=top1,
        margins=margins,
        correct=correct,
    )


# Must match classification.scoring.ts#SOURCE_WEIGHTS, or the trainer reports an accuracy the
# server never delivers and the rebuild gate compares against the wrong thing.
SOURCE_WEIGHTS = {"lexicon": 1.0, "tariff": 0.85}


def score_nearest_text(
    query_vectors: np.ndarray,
    corpus: np.ndarray,
    headings: list[str],
    sources: list[str],
    expected: list[str],
) -> Scored:
    """Scores the way the deployed server does: nearest single text, weighted by where it came from.

    This is the trainer's headline number precisely because it is what ships. Reporting the
    class-centroid score instead understates the system by around 40 points, and the rebuild gate
    compares against whatever this returns — a gate measuring something other than the deployed
    behaviour is worse than no gate at all.

    Mirrors classification.scoring.ts#classifyAgainst, including taking the best score per heading:
    several texts of one heading scoring highly is agreement, not ambiguity.
    """
    weights = np.array([SOURCE_WEIGHTS.get(source, 1.0) for source in sources], dtype=np.float32)
    similarity = (normalise(query_vectors) @ corpus.T) * weights

    classes = sorted(set(headings))
    index = {heading: i for i, heading in enumerate(classes)}
    per_heading = np.full((similarity.shape[0], len(classes)), -2.0, dtype=np.float32)
    for column, heading in enumerate(headings):
        target = index[heading]
        np.maximum(per_heading[:, target], similarity[:, column], out=per_heading[:, target])

    return score_matrix(per_heading, classes, expected)
