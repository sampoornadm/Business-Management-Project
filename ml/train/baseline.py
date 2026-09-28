#!/usr/bin/env python
"""Measures a FROZEN embedder on the real eval set — the floor a fine-tune has to clear.

    uv run python baseline.py                      # frozen e5-small, prototype cosine
    uv run python baseline.py --model BAAI/bge-m3  # the embedder the app uses today
    uv run python baseline.py --probe              # also fit a linear probe on frozen vectors

Two numbers matter and they are different questions. Prototype cosine asks "can this embedder tell
these classes apart at all"; the linear probe asks "is the information there, just not in cosine
geometry". A fine-tune that beats neither is not worth shipping.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

from bmp_hsn.data import REPO_ROOT, load_eval, load_examples
from bmp_hsn.scoring import build_prototypes, score

# e5 was trained with these prefixes and degrades measurably without them. A purchase-order line is
# the query; a heading's tariff text is the passage it should retrieve.
E5_QUERY = "query: "
E5_PASSAGE = "passage: "


def prefixes(model_name: str) -> tuple[str, str]:
    return (E5_QUERY, E5_PASSAGE) if "e5" in model_name.lower() else ("", "")


def encode(model: SentenceTransformer, texts: list[str], prefix: str, batch_size: int) -> np.ndarray:
    return model.encode(
        [prefix + text for text in texts],
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--device", default="mps")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--probe", action="store_true", help="also fit a logistic probe")
    args = parser.parse_args()

    train = load_examples("train")
    evaluation = load_eval()
    query_prefix, passage_prefix = prefixes(args.model)

    print(f"model:   {args.model} on {args.device}")
    print(f"corpus:  {len(train)} train texts, {len(set(e.heading for e in train))} classes")
    print(f"eval:    {len(evaluation)} real items with expert labels")

    started = time.time()
    model = SentenceTransformer(args.model, device=args.device)

    print("\nembedding the corpus...")
    corpus_vectors = encode(model, [e.text for e in train], passage_prefix, args.batch_size)
    prototypes, classes = build_prototypes(corpus_vectors, [e.heading for e in train])

    print("embedding the eval items...")
    eval_vectors = encode(
        model, [item.description for item in evaluation], query_prefix, args.batch_size
    )

    expected = [item.expected for item in evaluation]
    result = score(eval_vectors, prototypes, classes, expected)
    elapsed = time.time() - started

    print(f"\n--- frozen {args.model}, prototype cosine ---")
    print(f"accuracy (top-1): {sum(result.correct)}/{result.n} = {result.accuracy:.1%}")
    print(f"top-5:            {result.top5:.1%}")
    print(f"chapter accuracy: {result.chapter_accuracy:.1%}")
    print(f"median margin:    {np.median(result.margins):.4f}")

    probe_accuracy = None
    if args.probe:
        probe_accuracy = run_probe(corpus_vectors, train, eval_vectors, expected)

    write_report(args, result, elapsed, probe_accuracy, evaluation, classes)


def run_probe(
    corpus_vectors: np.ndarray, train, eval_vectors: np.ndarray, expected: list[str]
) -> float:
    from sklearn.linear_model import LogisticRegression

    print("\nfitting a logistic probe on the frozen vectors (this is the slow part)...")
    labels = [e.heading for e in train]
    probe = LogisticRegression(max_iter=1000, n_jobs=-1)
    probe.fit(corpus_vectors, labels)
    predicted = probe.predict(eval_vectors)
    accuracy = float(np.mean([p == w for p, w in zip(predicted, expected)]))
    print(f"--- linear probe ---\naccuracy: {accuracy:.1%}")
    return accuracy


def write_report(args, result, elapsed: float, probe_accuracy, evaluation, classes) -> None:
    stamp = datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
    run_dir = REPO_ROOT / "ml" / "runs" / f"{stamp}-baseline"
    run_dir.mkdir(parents=True, exist_ok=True)

    misses = [
        f"| {item.expected} | {got} | {item.description[:80]} |"
        for item, got, ok in zip(evaluation, result.top1, result.correct)
        if not ok
    ]

    lines = [
        f"# Baseline — frozen `{args.model}`, prototype cosine",
        "",
        f"Run: {datetime.now(timezone.utc).isoformat()}",
        f"Embedding + scoring took {elapsed:.0f}s on {args.device}.",
        "",
        "No fine-tuning. Each heading is the mean of its training texts; an item is classified by",
        "nearest prototype. This is the floor a trained model has to clear.",
        "",
        "## Result",
        "",
        f"- Items scored: **{result.n}**",
        f"- Top-1: **{sum(result.correct)}/{result.n} = {result.accuracy:.1%}**",
        f"- Top-5: {result.top5:.1%}",
        f"- Chapter (2-digit) accuracy: {result.chapter_accuracy:.1%}",
        f"- Median top1-top2 margin: {np.median(result.margins):.4f}",
        f"- Classes: {len(classes)}",
    ]
    if probe_accuracy is not None:
        lines.append(f"- Linear probe on the same frozen vectors: **{probe_accuracy:.1%}**")
    lines += [
        "",
        "Chapter accuracy is reported separately because getting the chapter right and the heading",
        "wrong is a near miss worth seeing, while getting the chapter wrong means the embedder has",
        "no idea what the item is made of.",
        "",
        "## Misses",
        "",
        "| expected | got | description |",
        "| --- | --- | --- |",
        *misses,
        "",
    ]

    (run_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")
    (run_dir / "results.json").write_text(
        json.dumps(
            {
                "model": args.model,
                "accuracy": result.accuracy,
                "top5": result.top5,
                "chapter_accuracy": result.chapter_accuracy,
                "probe_accuracy": probe_accuracy,
                "n": result.n,
                "classes": len(classes),
                "predictions": [
                    {"description": i.description, "expected": i.expected, "got": g, "correct": c}
                    for i, g, c in zip(evaluation, result.top1, result.correct)
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\nreport: {run_dir.relative_to(REPO_ROOT)}/report.md")


if __name__ == "__main__":
    main()
