#!/usr/bin/env python
"""Exports the trained model to ONNX for in-process inference in Node, and verifies the export.

    uv sync --extra export
    uv run python export_onnx.py

The verification is the point. Transformers.js loads the tokenizer from the same directory, so an
export that silently tokenizes differently from training produces vectors that are wrong but look
perfectly reasonable — no error, no crash, just worse answers that nobody can trace back to here.
So this compares ONNX output against the PyTorch model it came from and refuses to ship on drift.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from bmp_hsn.data import REPO_ROOT

MODEL_DIR = REPO_ROOT / "ml" / "models" / "current"
ONNX_DIR = MODEL_DIR / "onnx"

# Real purchase-order text, including the two probes this whole project started from.
PROBES = [
    "query: WASHER TYPE : DISC SPRING MATERIAL : SPRING STEEL 51CRV4",
    "query: SOCKET MATERIAL : MILD STEEL, IS:1239",
    "query: SLEEVE,3MM,FIBER GLASS COATING: SILICONE, BREAKDOWN VOLTAGE 1.5-4 KV",
    "passage: Springs and leaves for springs, of iron or steel",
]
TOLERANCE = 1e-3


def export(quantize: bool) -> None:
    if not MODEL_DIR.exists():
        sys.exit(f"No trained model at {MODEL_DIR}. Run train.py first.")

    command = [
        "optimum-cli", "export", "onnx",
        "--model", str(MODEL_DIR),
        "--task", "feature-extraction",
        str(ONNX_DIR),
    ]
    print(" ".join(command))
    subprocess.run(command, check=True)

    if quantize:
        subprocess.run(
            ["optimum-cli", "onnxruntime", "quantize", "--avx512", "--onnx_model", str(ONNX_DIR),
             "-o", str(ONNX_DIR)],
            check=True,
        )


def verify() -> None:
    """Fails loudly if ONNX and PyTorch disagree — a quiet disagreement is the dangerous case."""
    import onnxruntime as ort
    from sentence_transformers import SentenceTransformer
    from transformers import AutoTokenizer

    torch_model = SentenceTransformer(str(MODEL_DIR), device="cpu")
    reference = torch_model.encode(PROBES, normalize_embeddings=True, show_progress_bar=False)

    model_file = next(ONNX_DIR.glob("model*.onnx"))
    session = ort.InferenceSession(str(model_file))
    tokenizer = AutoTokenizer.from_pretrained(str(ONNX_DIR))
    encoded = tokenizer(PROBES, padding=True, truncation=True, max_length=128, return_tensors="np")

    inputs = {i.name: encoded[i.name] for i in session.get_inputs() if i.name in encoded}
    hidden = session.run(None, inputs)[0]

    # e5 uses mean pooling over non-padding tokens; matching it here is what makes the comparison
    # meaningful rather than a comparison of two different pooling strategies.
    mask = encoded["attention_mask"][..., None].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
    pooled = pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)

    drift = np.abs(pooled - reference).max()
    cosines = (pooled * reference).sum(axis=1)
    print(f"\nmax abs drift vs PyTorch: {drift:.6f}")
    print("per-probe cosine:        " + ", ".join(f"{c:.6f}" for c in cosines))

    if drift > TOLERANCE:
        sys.exit(f"ONNX output drifts from PyTorch by {drift:.6f} (> {TOLERANCE}). Not shipping it.")

    (ONNX_DIR / "verification.json").write_text(
        json.dumps({"max_abs_drift": float(drift), "cosines": cosines.tolist(),
                    "tolerance": TOLERANCE}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\nverified. ONNX written to {ONNX_DIR.relative_to(REPO_ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quantize", action="store_true", help="int8 quantise after export")
    parser.add_argument("--skip-export", action="store_true", help="verify an existing export")
    args = parser.parse_args()

    if not args.skip_export:
        export(args.quantize)
    verify()


if __name__ == "__main__":
    main()
