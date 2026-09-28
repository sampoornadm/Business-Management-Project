"""Turns a cosine score into a probability, and picks the threshold below which the app abstains.

The app's standing rule is that an uncertain AI value never writes itself into a real field, so the
model has to say when it does not know. Raw cosine cannot do that job: the measured median top1-top2
margin on real items is 0.0043, and heading 7320 beat 7318 by 0.001 on a known item — numbers that
mean nothing to a person and are not comparable between items.

Everything here is cross-validated because the eval set is 76 items. Fitting the calibrator and
reading its precision off the same rows would report a number that nobody ever experiences.
"""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold


def _features(similarity: np.ndarray, margin: np.ndarray) -> np.ndarray:
    return np.column_stack([np.asarray(similarity, dtype=np.float64), np.asarray(margin, dtype=np.float64)])


class CrossValidatedCalibrator:
    """Logistic regression on (top-1 cosine, top1-top2 margin) -> probability of being correct."""

    def __init__(self, folds: int = 5) -> None:
        self.folds = folds
        self.model: LogisticRegression | None = None
        self.out_of_fold: np.ndarray = np.empty(0)

    def fit(self, similarity: np.ndarray, margin: np.ndarray, correct: np.ndarray) -> "CrossValidatedCalibrator":
        features = _features(similarity, margin)
        labels = np.asarray(correct).astype(int)
        self.out_of_fold = np.zeros(len(labels), dtype=np.float64)

        # One class only (everything right, or everything wrong) leaves nothing to separate; fall
        # back to the base rate so the caller still gets a usable, honest number.
        if len(np.unique(labels)) < 2:
            self.out_of_fold[:] = float(labels.mean())
            self.model = None
            return self

        usable_folds = max(2, min(self.folds, int(np.bincount(labels).min())))
        splitter = StratifiedKFold(n_splits=usable_folds, shuffle=True, random_state=20260928)
        for train_idx, test_idx in splitter.split(features, labels):
            fold = LogisticRegression(max_iter=1000).fit(features[train_idx], labels[train_idx])
            self.out_of_fold[test_idx] = fold.predict_proba(features[test_idx])[:, 1]

        self.model = LogisticRegression(max_iter=1000).fit(features, labels)
        return self

    def predict(self, similarity: np.ndarray, margin: np.ndarray) -> np.ndarray:
        if self.model is None:
            return np.full(len(np.asarray(similarity)), float(self.out_of_fold.mean() if len(self.out_of_fold) else 0.0))
        return self.model.predict_proba(_features(similarity, margin))[:, 1]


def coverage_at_precision(
    confidence: np.ndarray, correct: np.ndarray, target: float
) -> tuple[float, float, float]:
    """Lowest threshold whose answered set still hits `target` precision.

    Returns (threshold, precision, coverage). Coverage is the share of items answered at all — the
    price paid for the precision, and the number that decides whether abstention is tolerable.
    """
    confidence = np.asarray(confidence, dtype=np.float64)
    correct = np.asarray(correct).astype(int)

    best = (float(confidence.max()) + 1e-6, 0.0, 0.0)
    for threshold in sorted(set(confidence.tolist()), reverse=True):
        answered = confidence >= threshold
        if not answered.any():
            continue
        precision = float(correct[answered].mean())
        if precision >= target:
            best = (float(threshold), precision, float(answered.mean()))

    return best
