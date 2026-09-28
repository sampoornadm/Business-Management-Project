#!/usr/bin/env python
"""Writes the vector index the server classifies against.

    uv run python build_index.py

Every training text, embedded by the trained model and labelled with its heading. NOT one mean
vector per heading: measured on real purchase-order lines, nearest-text scores 68.4% against 50.0%
for nearest-centroid, and it wins on both halves of the eval set independently. Averaging buries the
curated trade terms — heading 7320 has two of them against eleven rows of tariff prose, so a
disc-spring washer ends up on 7318, whose own tariff text says "washers (including spring washers)".
Keeping the texts separate is also what makes the sheet's trade_terms column an effective lever:
one added phrase competes on its own rather than being diluted.

The index is a pure function of (model, corpus), so it lives beside the model that produced it —
rebuilt whenever either changes, and unable to drift from the weights the way a copy in the database
could. 9,490 vectors of 384 floats is 14 MB; the server scans them exhaustively, which is exact and
takes microseconds.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

import numpy as np
from sentence_transformers import SentenceTransformer

from bmp_hsn.data import REPO_ROOT, load_examples

MODEL_DIR = REPO_ROOT / "ml" / "models" / "current"
PASSAGE = "passage: "


def main() -> None:
    examples = load_examples("train")
    model = SentenceTransformer(str(MODEL_DIR), device="mps")
    model.max_seq_length = 128

    print(f"embedding {len(examples)} texts...")
    vectors = model.encode(
        [PASSAGE + e.text for e in examples],
        batch_size=64,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype(np.float32)

    headings = [e.heading for e in examples]
    sources = [e.source for e in examples]
    matrix = np.ascontiguousarray(vectors, dtype="<f4")

    target = MODEL_DIR / "index.json"
    target.write_text(
        json.dumps(
            {
                "builtAt": datetime.now(timezone.utc).isoformat(),
                "dimensions": int(matrix.shape[1]),
                "headings": headings,
                # Per-entry provenance. The server weights a curated trade term above tariff prose:
                # measured on 933 held-out headings, weighting tariff at 0.85 gains 3.8 points on
                # headings that have curated terms and costs 0.4 on those that do not.
                "sources": sources,
                # Little-endian float32, row-major, one row per entry in `headings` order.
                "vectors": base64.b64encode(matrix.tobytes()).decode("ascii"),
            }
        )
        + "\n",
        encoding="utf-8",
    )

    print(
        f"wrote {target.relative_to(REPO_ROOT)}: "
        f"{len(headings)} texts across {len(set(headings))} headings x {matrix.shape[1]} dims "
        f"({target.stat().st_size / 1e6:.1f} MB)"
    )


if __name__ == "__main__":
    main()
