import type { CategoryLeafDto } from "@bmp/types";

import { sameSpec } from "../../shared/utils/spec-match.js";

import type { NearestConfirmedMatch } from "./items.repository.js";

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * The canonical grouping key for an item. Prefers the AI's canonical rewrite (BoqItem
 * .normalizedName) when present, else the cleaned line description. Capped at 300 chars so
 * the (businessId, canonicalName) unique btree index stays within Postgres' row-size limit.
 */
export function deriveCanonicalName(normalizedName: string | null, description: string): string {
  const base = (normalizedName && normalizedName.trim()) || collapseWhitespace(description) || "Unnamed item";
  return base.slice(0, 300);
}

export interface ClassificationResult {
  categoryId: string | null;
  confidence: number;
}

/**
 * Rung-1 human-feedback reuse: reuse a human-confirmed item's category if it's provably the SAME
 * item as `target` — cosine already found `best` as the nearest confirmed candidate (via ANN);
 * this only checks the two signals cosine similarity alone can't guarantee: identical numeric
 * specs and matching unit. The same bar boq-enrichment uses before trusting a historical rate.
 */
export function pickConfirmedMatch(
  target: { canonicalName: string; unit: string | null },
  best: Pick<NearestConfirmedMatch, "categoryId" | "canonicalName" | "unit" | "similarity"> | null,
  threshold: number,
): { categoryId: string; confidence: number } | null {
  if (!best) return null;

  const unitOk = target.unit === null || best.unit === target.unit;
  if (best.similarity >= threshold && unitOk && sameSpec(target.canonicalName, best.canonicalName)) {
    return { categoryId: best.categoryId, confidence: best.similarity };
  }
  return null;
}

/**
 * The model is handed a closed list of leaf ids and MUST return one of them (or null). Anything
 * it invents is rejected here — an out-of-set id becomes null, never a made-up category. This is
 * the whole point of a fixed taxonomy: the LLM classifies, it never defines the vocabulary.
 */
export function parseClassification(raw: unknown, leafIds: Set<string>): ClassificationResult {
  if (typeof raw !== "object" || raw === null) return { categoryId: null, confidence: 0 };
  const record = raw as Record<string, unknown>;

  const candidate = typeof record.categoryId === "string" ? record.categoryId.trim() : "";
  const categoryId = leafIds.has(candidate) ? candidate : null;

  const rawConfidence =
    typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? Math.min(Math.max(record.confidence, 0), 1)
      : 0.5;

  // No category => no confidence; don't let the model claim certainty about "none".
  return { categoryId, confidence: categoryId ? rawConfidence : 0 };
}

export function buildClassifyPrompt(
  canonicalName: string,
  unit: string | null,
  leaves: CategoryLeafDto[],
  examples: Array<{ name: string; path: string }>,
): string {
  const options = leaves.map((l) => `  - ${l.id}: ${l.path}`).join("\n");
  const context = examples.length
    ? examples.map((e) => `  - "${e.name}" -> ${e.path}`).join("\n")
    : "  (none yet)";

  return [
    "You classify a construction procurement item into exactly one category.",
    "",
    `Item: "${canonicalName}"`,
    `Unit: ${unit ?? "unknown"}`,
    "",
    "Choose exactly one categoryId from this list, or null if none genuinely fit:",
    options,
    "",
    "Examples of items this company has already classified, for consistency:",
    context,
    "",
    'Return JSON only: { "categoryId": "<one id from the list above, or null>", "confidence": 0..1 }',
    "Never invent an id that is not in the list. If unsure, return null.",
  ].join("\n");
}
