#!/usr/bin/env python
"""Fine-tunes the HSN heading bi-encoder on Metal, then scores it against the real eval set.

    uv run python train.py
    uv run python train.py --epochs 2 --batch-size 32     # if memory is tight

Ships only if it beats the frozen-model baseline. The comparison is printed and written into the
run report either way, including when it loses — a fine-tune that does not beat prototype cosine on
real purchase-order text is a fine-tune that should not be deployed.

Model selection uses validation.jsonl (held-out tariff text). The real-item eval set is scored ONCE
at the end and never used to choose a checkpoint: it is 76 items, and picking a checkpoint against
it would turn the only honest measurement into a training signal.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from sentence_transformers.sentence_transformer.losses import MultipleNegativesRankingLoss

from bmp_hsn.data import REPO_ROOT, load_eval, load_examples
from bmp_hsn.pairs import build_batches, build_pairs
from bmp_hsn.scoring import build_prototypes, score

QUERY = "query: "
PASSAGE = "passage: "


def encode(model: SentenceTransformer, texts: list[str], prefix: str, batch_size: int) -> np.ndarray:
    return model.encode(
        [prefix + text for text in texts],
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    ).astype(np.float32)


def evaluate(model: SentenceTransformer, train_examples, items, batch_size: int):
    """Prototype-cosine evaluation — the same thing the Node side will do at inference."""
    corpus = encode(model, [e.text for e in train_examples], PASSAGE, batch_size)
    prototypes, classes = build_prototypes(corpus, [e.heading for e in train_examples])
    queries = encode(model, [i.description for i in items], QUERY, batch_size)
    return score(queries, prototypes, classes, [i.expected for i in items]), classes


def train_loop(model: SentenceTransformer, pairs, args) -> tuple[float, float]:
    """Plain PyTorch loop over class-distinct batches.

    Not HuggingFace's Trainer on purpose: measured on this machine it ran ~20 s per step against
    184 ms for this loop — a 100x gap on identical shapes, with MPS forward passes timed at 27 ms
    per 32 texts either way. The bottleneck was the Trainer's own machinery, not Metal, and a
    four-epoch run goes from eleven hours to about three minutes.
    """
    loss_fn = MultipleNegativesRankingLoss(model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)

    batches_per_epoch = len(build_batches(pairs, args.batch_size, seed=0))
    total_steps = max(1, batches_per_epoch * args.epochs)
    warmup = max(1, int(total_steps * 0.1))

    def learning_rate_at(step: int) -> float:
        if step < warmup:
            return step / warmup
        remaining = (step - warmup) / max(1, total_steps - warmup)
        return max(0.0, 1.0 - remaining)

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, learning_rate_at)
    started = time.time()
    step = 0

    # Required, not defensive: the frozen-baseline scoring that runs first calls model.encode(),
    # which leaves the model in eval mode. Training from there silently disables dropout.
    model.train()

    for epoch in range(args.epochs):
        # Reshuffled each epoch, so a pair meets different negatives every time it is seen.
        batches = build_batches(pairs, args.batch_size, seed=args.seed + epoch)
        running = 0.0

        for batch in batches:
            features = [
                to_device(model, [QUERY + pair.anchor for pair in batch], args.device),
                to_device(model, [PASSAGE + pair.positive for pair in batch], args.device),
            ]
            loss = loss_fn(features, None)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()

            running += float(loss.detach())
            step += 1
            if step % 50 == 0:
                # flush: stdout is block-buffered when redirected to a file, and a training run
                # with no visible progress for minutes is indistinguishable from a hung one.
                print(f"  epoch {epoch + 1}/{args.epochs}  step {step}/{total_steps}  "
                      f"loss {running / 50:.4f}", flush=True)
                running = 0.0

    model.eval()
    if args.device == "mps":
        torch.mps.synchronize()
        peak = torch.mps.driver_allocated_memory() / 1e9
    else:
        peak = 0.0
    return (time.time() - started) / 60, peak


def to_device(model: SentenceTransformer, texts: list[str], device: str) -> dict:
    features = model.tokenize(texts)
    return {k: (v.to(device) if hasattr(v, "to") else v) for k, v in features.items()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--eval-batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-seq-length", type=int, default=128)
    parser.add_argument("--max-pairs-per-class", type=int, default=8)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--seed", type=int, default=20260928)
    args = parser.parse_args()

    torch.manual_seed(args.seed)

    train_examples = load_examples("train")
    evaluation = load_eval()
    pairs = build_pairs(train_examples, max_per_class=args.max_pairs_per_class)

    print(f"corpus: {len(train_examples)} texts, {len(set(e.heading for e in train_examples))} classes")
    print(f"pairs:  {len(pairs)} (max {args.max_pairs_per_class} per class)")
    print(f"eval:   {len(evaluation)} real items\n")

    model = SentenceTransformer(args.model, device=args.device)
    model.max_seq_length = args.max_seq_length

    print("scoring the frozen model first, so the comparison is against this exact setup...")
    before, _ = evaluate(model, train_examples, evaluation, args.eval_batch_size)
    print(f"  before fine-tuning: {sum(before.correct)}/{before.n} = {before.accuracy:.1%}\n")

    stamp = datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
    run_dir = REPO_ROOT / "ml" / "runs" / f"{stamp}-train"
    run_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    minutes, peak = train_loop(model, pairs, args)
    print(f"\ntrained in {minutes:.1f} min, peak MPS allocation {peak:.1f} GB")

    after, classes = evaluate(model, train_examples, evaluation, args.eval_batch_size)

    print(f"\n--- fine-tuned {args.model} ---")
    print(f"top-1:            {sum(after.correct)}/{after.n} = {after.accuracy:.1%}"
          f"  (frozen: {before.accuracy:.1%})")
    print(f"top-5:            {after.top5:.1%}  (frozen: {before.top5:.1%})")
    print(f"chapter accuracy: {after.chapter_accuracy:.1%}  (frozen: {before.chapter_accuracy:.1%})")
    print(f"median margin:    {np.median(after.margins):.4f}  (frozen: {np.median(before.margins):.4f})")

    beats = after.accuracy > before.accuracy
    print(f"\n{'BEATS' if beats else 'DOES NOT BEAT'} the frozen baseline.")

    model_dir = REPO_ROOT / "ml" / "models" / "current"
    model_dir.mkdir(parents=True, exist_ok=True)
    model.save(str(model_dir))
    (model_dir / "labels.json").write_text(json.dumps(classes, indent=0), encoding="utf-8")
    print(f"saved model to {model_dir.relative_to(REPO_ROOT)}")

    write_report(args, before, after, minutes, peak, beats, evaluation, classes, run_dir, len(pairs))


def write_report(
    args, before, after, minutes, peak, beats, evaluation, classes, run_dir, pair_count
) -> None:
    misses = [
        f"| {item.expected} | {got} | {item.description[:80]} |"
        for item, got, ok in zip(evaluation, after.top1, after.correct)
        if not ok
    ]

    # Per-class counts, because 76 items is small and a handful of item families dominate it.
    per_class: dict[str, list[int]] = {}
    for item, ok in zip(evaluation, after.correct):
        bucket = per_class.setdefault(item.expected, [0, 0])
        bucket[0] += int(ok)
        bucket[1] += 1

    lines = [
        f"# Fine-tune — `{args.model}`",
        "",
        f"Run: {datetime.now(timezone.utc).isoformat()}",
        f"Trained {args.epochs} epochs on {pair_count} pairs in {minutes:.1f} min on {args.device}, "
        f"peak MPS allocation {peak:.1f} GB.",
        f"batch {args.batch_size}, lr {args.lr}, max_seq_len {args.max_seq_length}.",
        "",
        "## Result against the real eval set",
        "",
        "| metric | frozen | fine-tuned |",
        "| --- | --- | --- |",
        f"| top-1 | {before.accuracy:.1%} | **{after.accuracy:.1%}** |",
        f"| top-5 | {before.top5:.1%} | {after.top5:.1%} |",
        f"| chapter | {before.chapter_accuracy:.1%} | {after.chapter_accuracy:.1%} |",
        f"| median margin | {np.median(before.margins):.4f} | {np.median(after.margins):.4f} |",
        "",
        f"Items: {after.n}. Classes in the label space: {len(classes)}.",
        "",
        f"**{'Beats' if beats else 'Does not beat'} the frozen baseline.**"
        + ("" if beats else " On this evidence it should not be deployed."),
        "",
        "The eval set is 76 real purchase-order lines and a handful of item families dominate it, so",
        "these counts carry wide error bars. Per-class results are below for that reason; a headline",
        "percentage alone would hide which families actually moved.",
        "",
        "## Per class",
        "",
        "| heading | correct | of |",
        "| --- | --- | --- |",
        *[f"| {h} | {c} | {n} |" for h, (c, n) in sorted(per_class.items())],
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
                "epochs": args.epochs,
                "pairs": pair_count,
                "minutes": minutes,
                "frozen": {"accuracy": before.accuracy, "top5": before.top5},
                "finetuned": {"accuracy": after.accuracy, "top5": after.top5},
                "beats_baseline": beats,
                "predictions": [
                    {"description": i.description, "expected": i.expected, "got": g, "correct": c}
                    for i, g, c in zip(evaluation, after.top1, after.correct)
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"report: {run_dir.relative_to(REPO_ROOT)}/report.md")


if __name__ == "__main__":
    main()
