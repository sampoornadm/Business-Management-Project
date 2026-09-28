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
    similarity = normalise(query_vectors) @ prototypes.T
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
