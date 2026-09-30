#!/usr/bin/env python
"""Exports the trained model to ONNX for in-process inference in Node, and verifies the export.

    uv sync --extra export
    uv run python export_onnx.py

Plain torch.onnx.export of the encoder, not optimum: installing optimum-onnx resolves transformers
back to 4.x and sentence-transformers to 5.x, and a 5.x install cannot load a 6.x-saved model at all.
The encoder is a standard transformer, so optimum would only have bought a dependency war.

The verification is the point. Transformers.js loads the tokenizer from the same directory and does
its own pooling, so an export that pools differently, or tokenizes differently, produces vectors that
are wrong but look perfectly reasonable — no error, no crash, just worse answers nobody can trace
back to here. This compares ONNX against the PyTorch model it came from and refuses to ship on drift.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

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


def mean_pool(hidden: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    """Mean over non-padding tokens, then L2 normalise — what 1_Pooling and 2_Normalize do.

    Transformers.js does this itself given {pooling: 'mean', normalize: true}. Reproducing it here
    is what makes the comparison below a test of the export rather than of two pooling strategies.
    """
    mask = attention_mask[..., None].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / np.maximum(mask.sum(axis=1), 1e-9)
    return pooled / np.maximum(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12)


class EncoderForExport(torch.nn.Module):
    """Two named inputs, one output.

    The legacy ONNX exporter traces with positional arguments, and transformers 5's BertModel.forward
    takes `use_cache` in a position that then collides ("got multiple values for argument
    'use_cache'"). Calling it by keyword through a wrapper sidesteps that and pins the graph to
    exactly the tensors the Node side will feed and read.
    """

    def __init__(self, encoder: torch.nn.Module) -> None:
        super().__init__()
        self.encoder = encoder

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.encoder(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state


def export() -> None:
    from sentence_transformers import SentenceTransformer

    if not (MODEL_DIR / "model.safetensors").exists():
        sys.exit(f"No trained model at {MODEL_DIR}. Run train.py first.")

    model = SentenceTransformer(str(MODEL_DIR), device="cpu")
    encoder = EncoderForExport(model[0].auto_model).eval()
    tokenizer = model.tokenizer

    sample = tokenizer(PROBES, padding=True, truncation=True, max_length=128, return_tensors="pt")
    inputs = (sample["input_ids"], sample["attention_mask"])

    ONNX_DIR.mkdir(parents=True, exist_ok=True)
    target = ONNX_DIR / "model.onnx"

    torch.onnx.export(
        encoder,
        inputs,
        str(target),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        # Both axes dynamic: the server embeds one item at a time and a whole catalogue in batches,
        # at whatever length the text happens to be.
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "last_hidden_state": {0: "batch", 1: "sequence"},
        },
        opset_version=14,
        do_constant_folding=True,
        # The dynamo exporter writes a 1.6 MB graph plus a 470 MB model.onnx.data beside it. A
        # sidecar file is one more thing to deploy and to get wrong, and it has to travel with the
        # graph; the legacy exporter packs the weights inline, well under protobuf's 2 GB ceiling.
        dynamo=False,
    )
    print(f"exported {target.relative_to(REPO_ROOT)} ({target.stat().st_size / 1e6:.0f} MB)")


def quantize() -> Path:
    """int8 weights. The embedding table is 250k x 384 and dominates the file at fp32.

    Built, measured, and NOT shipped — the server loads fp32 (see classification.embedder.ts).
    Two objections, either of which is enough. It costs about 8 points of accuracy on the real
    items (92.1% against 84.2%). And dynamic int8 derives activation scales per batch, so a text's
    vector depends on what else was in the batch with it — measured at cosine 0.985-0.990 between
    the same string alone and batched, identically in Python and in Node. That is enough to change
    an item's HSN code between two runs over the same data, which is the disqualifying one.
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    target = ONNX_DIR / "model_quantized.onnx"
    quantize_dynamic(
        model_input=str(ONNX_DIR / "model.onnx"),
        model_output=str(target),
        weight_type=QuantType.QInt8,
    )
    print(f"quantized {target.relative_to(REPO_ROOT)} ({target.stat().st_size / 1e6:.0f} MB)")
    return target


def accuracy_through_onnx(model_file: Path) -> float:
    """Scores the real eval set through ONNX — the check that actually matters.

    Per-probe drift says the tensors match on four strings. This says the thing the app will ship
    still gets the same answers, which is what quantisation could quietly cost.
    """
    import onnxruntime as ort
    from sentence_transformers import SentenceTransformer

    from bmp_hsn.data import load_eval, load_examples
    from bmp_hsn.scoring import score_nearest_text

    tokenizer = SentenceTransformer(str(MODEL_DIR), device="cpu").tokenizer
    session = ort.InferenceSession(str(model_file))

    def embed(texts: list[str], prefix: str, batch: int = 32) -> np.ndarray:
        out = []
        for start in range(0, len(texts), batch):
            chunk = [prefix + t for t in texts[start : start + batch]]
            encoded = tokenizer(chunk, padding=True, truncation=True, max_length=128, return_tensors="np")
            feeds = {i.name: encoded[i.name] for i in session.get_inputs()}
            out.append(mean_pool(session.run(None, feeds)[0], encoded["attention_mask"]))
        return np.vstack(out).astype(np.float32)

    train = load_examples("train")
    items = load_eval()
    # Scored the way the server scores, so this number is comparable with every other number in
    # the project rather than being a third measurement of a fourth thing.
    result = score_nearest_text(
        embed([i.description for i in items], "query: "),
        embed([e.text for e in train], "passage: "),
        [e.heading for e in train],
        [e.source for e in train],
        [i.expected for i in items],
    )
    return result.accuracy


def verify() -> None:
    import onnxruntime as ort
    from sentence_transformers import SentenceTransformer

    torch_model = SentenceTransformer(str(MODEL_DIR), device="cpu")
    reference = torch_model.encode(PROBES, normalize_embeddings=True, show_progress_bar=False)

    session = ort.InferenceSession(str(ONNX_DIR / "model.onnx"))
    encoded = torch_model.tokenizer(
        PROBES, padding=True, truncation=True, max_length=128, return_tensors="np"
    )
    feeds = {i.name: encoded[i.name] for i in session.get_inputs()}
    pooled = mean_pool(session.run(None, feeds)[0], encoded["attention_mask"])

    drift = float(np.abs(pooled - reference).max())
    cosines = (pooled * reference).sum(axis=1)
    print(f"\nmax abs drift vs PyTorch: {drift:.6f}")
    print("per-probe cosine:        " + ", ".join(f"{c:.6f}" for c in cosines))

    if drift > TOLERANCE:
        sys.exit(f"ONNX drifts from PyTorch by {drift:.6f} (> {TOLERANCE}). Not shipping it.")

    (ONNX_DIR / "verification.json").write_text(
        json.dumps(
            {"max_abs_drift": drift, "cosines": cosines.tolist(), "tolerance": TOLERANCE}, indent=2
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nverified. ONNX written to {ONNX_DIR.relative_to(REPO_ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-export", action="store_true", help="verify an existing export")
    parser.add_argument("--no-quantize", action="store_true", help="keep fp32 only")
    args = parser.parse_args()

    if not args.skip_export:
        for stale in ONNX_DIR.glob("*.onnx.data"):
            stale.unlink()  # left by an earlier dynamo export; nothing references it now
        export()
    verify()

    if args.no_quantize:
        return

    quantized = quantize()
    print("\nscoring the real eval set through each build (this is the check that matters)...")
    fp32 = accuracy_through_onnx(ONNX_DIR / "model.onnx")
    int8 = accuracy_through_onnx(quantized)
    print(f"  fp32 ONNX: {fp32:.1%}")
    print(f"  int8 ONNX: {int8:.1%}")

    verification = json.loads((ONNX_DIR / "verification.json").read_text(encoding="utf-8"))
    verification.update({"accuracy_fp32": fp32, "accuracy_int8": int8})
    (ONNX_DIR / "verification.json").write_text(json.dumps(verification, indent=2) + "\n", encoding="utf-8")

    # Informational, NOT a gate. The server loads fp32 (see classification.embedder.ts), so int8
    # being worse is the expected finding rather than a failure — and aborting here used to kill the
    # whole rebuild after the training had already been paid for and every artifact written, over a
    # build nothing loads. What does gate is verify() above: fp32 must match the PyTorch model.
    if int8 < fp32 - 0.02:
        print(
            f"\nnote: int8 is {100 * (fp32 - int8):.1f} points worse than fp32 "
            f"({int8:.1%} vs {fp32:.1%}). Not a problem — fp32 is what ships.",
        )

    write_parity_fixture()


def write_parity_fixture() -> None:
    """Records reference vectors so the Node side can prove it agrees with Python.

    Node runs the same weights through a different tokenizer implementation and does its own
    pooling. If either diverges the vectors are still 384 finite numbers that embed and rank without
    complaint — the failure is silent and shows up only as worse answers. A committed fixture turns
    that into a failing test.
    """
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(str(MODEL_DIR), device="cpu")
    vectors = model.encode(PROBES, normalize_embeddings=True, show_progress_bar=False)

    # Under ml/data, not ml/models: models/ is gitignored (rebuilt per run) and the server's tests
    # need this file in version control to assert against.
    fixture = REPO_ROOT / "ml" / "data" / "eval" / "parity-fixture.json"
    fixture.write_text(
        json.dumps(
            {
                "note": "Reference vectors from PyTorch. ml/train/export_onnx.py writes this; the "
                        "server's classification tests assert Node reproduces them.",
                "tolerance_cosine": 0.999,
                "probes": [
                    {"text": text, "vector": [round(float(v), 6) for v in vector]}
                    for text, vector in zip(PROBES, vectors)
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"parity fixture: {fixture.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
