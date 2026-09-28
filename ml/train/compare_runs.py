#!/usr/bin/env python
"""Compares every training run and reports an epoch count chosen without reading the answer off it.

    uv run python compare_runs.py

Each run wrote per-item predictions, so the honest comparison can be done after the fact: split the
eval items in half, pick the best run on the first half, and report that run's score on the second.
The headline number from the sweep itself is optimistic — four settings each got a chance at the
same 76 items, and the winner banks the noise.
"""

from __future__ import annotations

import json
from pathlib import Path

from bmp_hsn.data import REPO_ROOT
from bmp_hsn.holdout import stratified_halves

RUNS = REPO_ROOT / "ml" / "runs"


def load_runs() -> list[dict]:
    runs = []
    for results in sorted(RUNS.glob("*-train/results.json")):
        data = json.loads(results.read_text(encoding="utf-8"))
        # Runs from before the server switched to nearest-text scoring measured a different thing
        # entirely (centroids, ~40 points lower). Comparing across the two would be meaningless.
        if data.get("scheme") != "nearest-text+source-weights":
            continue
        data["path"] = results.parent.name
        runs.append(data)
    return runs


def accuracy(predictions: list[dict]) -> float:
    return sum(p["correct"] for p in predictions) / len(predictions) if predictions else 0.0


def main() -> None:
    runs = load_runs()
    if not runs:
        raise SystemExit(f"No training runs under {RUNS}. Run train.py first.")

    rows = []
    for run in runs:
        select, test = stratified_halves(run["predictions"], key=lambda p: p["expected"])
        rows.append(
            {
                "epochs": run["epochs"],
                "path": run["path"],
                "all": run["finetuned"]["accuracy"],
                "frozen": run["frozen"]["accuracy"],
                "select": accuracy(select),
                "test": accuracy(test),
                "n_select": len(select),
                "n_test": len(test),
            }
        )

    rows.sort(key=lambda r: r["epochs"])
    print(f"{'epochs':>6}  {'all 76':>7}  {'select half':>11}  {'test half':>9}")
    for row in rows:
        print(f"{row['epochs']:>6}  {row['all']:>6.1%}  {row['select']:>11.1%}  {row['test']:>9.1%}")

    best = max(rows, key=lambda r: r["select"])
    frozen = rows[0]["frozen"]

    print(f"\nfrozen baseline (all 76):       {frozen:.1%}")
    print(f"chosen on the selection half:   {best['epochs']} epochs ({best['select']:.1%} there)")
    print(f"ITS SCORE ON THE HELD-OUT HALF: {best['test']:.1%}  (n={best['n_test']})")
    print(
        "\nThe last line is the one to quote. The sweep's own best-of-four is optimistic; this is\n"
        "what the same choice procedure delivers on items it never saw."
    )


if __name__ == "__main__":
    main()
