#!/usr/bin/env python
"""Times each phase of a real training step, so a slow run is diagnosed instead of guessed at.

    uv run python profile_step.py
    uv run python profile_step.py --device cpu

Exists because three separate attempts to speed up training were aimed at the wrong thing. Micro
benchmarks on synthetic text said 184 ms/step; the real loop ran at 25 s. This uses the real model,
the real batches and torch.mps.synchronize() between phases, which is the only way the numbers mean
anything on Metal — without it every timing is just how fast the work was queued.
"""

from __future__ import annotations

import argparse
import time

import torch
from sentence_transformers import SentenceTransformer
from sentence_transformers.sentence_transformer.losses import MultipleNegativesRankingLoss

from bmp_hsn.data import load_examples
from bmp_hsn.pairs import build_batches, build_pairs
from bmp_hsn.tokenize import tokenize_batch


def sync(device: str) -> None:
    if device == "mps":
        torch.mps.synchronize()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="mps")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--max-seq-length", type=int, default=128)
    parser.add_argument("--steps", type=int, default=5)
    parser.add_argument("--no-clip", action="store_true")
    parser.add_argument(
        "--encode-first",
        action="store_true",
        help="embed the whole corpus before profiling, the way train.py scores the frozen baseline",
    )
    args = parser.parse_args()

    model = SentenceTransformer("intfloat/multilingual-e5-small", device=args.device)
    model.max_seq_length = args.max_seq_length

    if args.encode_first:
        started = time.time()
        model.encode(
            [e.text for e in load_examples("train")],
            batch_size=64,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        print(f"encoded the corpus first in {time.time() - started:.0f}s", flush=True)

    model.train()
    loss_fn = MultipleNegativesRankingLoss(model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-5)

    pairs = build_pairs(load_examples("train"))
    batches = build_batches(pairs, args.batch_size, group_by_length=True)
    print(f"device={args.device} batch={args.batch_size} seq={args.max_seq_length} "
          f"clip={not args.no_clip}  batches={len(batches)}", flush=True)

    totals = {"tokenize": 0.0, "forward": 0.0, "backward": 0.0, "clip": 0.0, "optim": 0.0}

    for i, batch in enumerate(batches[: args.steps + 1]):
        if i == 1:
            totals = {k: 0.0 for k in totals}  # discard the first step: it compiles kernels

        t0 = time.time()
        feats = [
            tokenize_batch(model, [prefix + t for t in texts], args.device)
            for prefix, texts in (
                ("query: ", [p.anchor for p in batch]),
                ("passage: ", [p.positive for p in batch]),
            )
        ]
        sync(args.device)
        t1 = time.time()

        loss = loss_fn(feats, None)
        sync(args.device)
        t2 = time.time()

        loss.backward()
        sync(args.device)
        t3 = time.time()

        if not args.no_clip:
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        sync(args.device)
        t4 = time.time()

        optimizer.step()
        optimizer.zero_grad()
        sync(args.device)
        t5 = time.time()

        totals["tokenize"] += t1 - t0
        totals["forward"] += t2 - t1
        totals["backward"] += t3 - t2
        totals["clip"] += t4 - t3
        totals["optim"] += t5 - t4

        tokens = feats[0]["input_ids"].shape[1]
        print(f"  step {i}: {(t5 - t0) * 1000:7.0f} ms  (padded to {tokens} tokens)", flush=True)

    total = sum(totals.values())
    print(f"\naverage over {args.steps} steps: {total / args.steps * 1000:.0f} ms/step")
    for phase, seconds in totals.items():
        print(f"  {phase:9s} {seconds / args.steps * 1000:7.0f} ms  ({100 * seconds / total:4.1f}%)")


if __name__ == "__main__":
    main()
