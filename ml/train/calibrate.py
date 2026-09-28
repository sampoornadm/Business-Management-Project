#!/usr/bin/env python
"""Chooses the confidence threshold below which the app declines to suggest a code.

    uv run python calibrate.py

The app's standing rule is that an uncertain AI value never writes itself into a real field, so the
classifier has to know when to say nothing. Raw cosine cannot carry that judgement: the measured
median gap between the top two headings is small, and a known case came down to 0.001 — numbers that
mean nothing to a person and are not comparable between items.

The confidence formula here MUST match classification.scoring.ts#confidenceOf. It is deliberately
tiny for that reason; if it grows, move it behind a fixture both sides assert against.
"""

from __future__ import annotations

import json

import numpy as np
from sentence_transformers import SentenceTransformer

from bmp_hsn.calibration import coverage_at_precision
from bmp_hsn.data import REPO_ROOT, load_eval, load_examples
from bmp_hsn.scoring import normalise

SOURCE_WEIGHTS = {"lexicon": 1.0, "tariff": 0.85}


def confidence_of(similarity: float, margin: float) -> float:
    """Mirror of classification.scoring.ts#confidenceOf."""
    return max(0.0, min(1.0, similarity)) * max(0.0, min(1.0, margin * 10))


def main() -> None:
    model = SentenceTransformer(str(REPO_ROOT / "ml/models/current"), device="mps")
    model.max_seq_length = 128
    train, items = load_examples("train"), load_eval()

    def encode(texts: list[str], prefix: str) -> np.ndarray:
        return model.encode(
            [prefix + t for t in texts], batch_size=64, convert_to_numpy=True,
            normalize_embeddings=True, show_progress_bar=False,
        ).astype(np.float32)

    corpus = encode([e.text for e in train], "passage: ")
    queries = normalise(encode([i.description for i in items], "query: "))
    headings = np.array([e.heading for e in train])
    weights = np.array([SOURCE_WEIGHTS.get(e.source, 1.0) for e in train], dtype=np.float32)

    scores = (queries @ corpus.T) * weights
    confidences, correct = [], []

    for row, item in enumerate(items):
        # Best score per heading, exactly as the server does it: several texts of one heading
        # agreeing is agreement, not ambiguity.
        best: dict[str, float] = {}
        for idx, heading in enumerate(headings):
            value = float(scores[row, idx])
            if value > best.get(heading, -2.0):
                best[heading] = value

        ranked = sorted(best.items(), key=lambda kv: -kv[1])
        top, runner_up = ranked[0], (ranked[1] if len(ranked) > 1 else None)
        margin = top[1] - runner_up[1] if runner_up else 1.0

        confidences.append(confidence_of(top[1], margin))
        correct.append(int(top[0] == item.expected))

    confidences_array = np.array(confidences)
    correct_array = np.array(correct)

    print(f"items: {len(items)}   accuracy with no threshold: {correct_array.mean():.1%}")
    print(f"confidence: min {confidences_array.min():.3f}  median "
          f"{np.median(confidences_array):.3f}  max {confidences_array.max():.3f}\n")

    print(f"{'target precision':>16}  {'threshold':>9}  {'precision':>9}  {'coverage':>8}")
    chosen = None
    for target in [0.90, 0.95, 0.98, 1.00]:
        threshold, precision, coverage = coverage_at_precision(confidences_array, correct_array, target)
        print(f"{target:>16.0%}  {threshold:>9.3f}  {precision:>9.1%}  {coverage:>8.1%}")
        if target == 0.95:
            chosen = {"target": target, "threshold": threshold, "precision": precision, "coverage": coverage}

    out = REPO_ROOT / "ml" / "data" / "eval" / "calibration.json"
    out.write_text(json.dumps({"chosen": chosen, "note":
        "threshold for >=95% precision on the real eval set; mirrors "
        "classification.scoring.ts#confidenceOf"}, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {out.relative_to(REPO_ROOT)}")
    print("Coverage is the share of items answered at all — the price paid for that precision.")


if __name__ == "__main__":
    main()
