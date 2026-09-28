"""Loads the datasets built by apps/server/scripts/build-hsn-dataset.ts.

The corpus is text-per-heading. A heading's 4-digit code IS the HSN code, so the label space and
the output the app needs are the same thing — there is no mapping step anywhere downstream.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATED = REPO_ROOT / "ml" / "data" / "generated"
EVAL_CSV = REPO_ROOT / "ml" / "data" / "eval" / "real-items.csv"


@dataclass(frozen=True)
class Example:
    text: str
    heading: str
    chapter: str
    source: str
    weight: float


@dataclass(frozen=True)
class EvalItem:
    description: str
    expected: str
    app_confirmed: str


def load_examples(name: str) -> list[Example]:
    path = GENERATED / f"{name}.jsonl"
    rows: list[Example] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            rows.append(
                Example(
                    text=raw["text"],
                    heading=raw["heading"],
                    chapter=raw["chapter"],
                    source=raw["source"],
                    weight=float(raw.get("weight", 1.0)),
                )
            )
    return rows


def load_eval() -> list[EvalItem]:
    """Real BOQ lines with expert labels. Rows with no expected label are not scoreable."""
    items: list[EvalItem] = []
    with EVAL_CSV.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            expected = (row.get("expected_heading") or "").strip()
            if not expected:
                continue
            items.append(
                EvalItem(
                    description=(row.get("description") or "").strip(),
                    expected=expected,
                    app_confirmed=(row.get("app_confirmed") or "").strip(),
                )
            )
    return items


def texts_by_heading(examples: list[Example]) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for example in examples:
        grouped.setdefault(example.heading, []).append(example.text)
    return grouped
