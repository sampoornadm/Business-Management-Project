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

/** How many of the (already similarity-ranked) ANN candidates Rung 1 will even look at. */
const CONFIRMED_MATCH_WINDOW = 5;

type ConfirmedMatchCandidate = Pick<
  NearestConfirmedMatch,
  "id" | "categoryId" | "canonicalName" | "unit" | "similarity"
>;

/**
 * Rung-1 human-feedback reuse: reuse a human-confirmed item's category if it's provably the SAME
 * item as `target`. Cosine ranks `candidates` (nearest confirmed items via ANN); each is checked
 * against the two signals cosine similarity alone can't guarantee — identical numeric specs and
 * matching unit — the same bar boq-enrichment uses before trusting a historical rate.
 *
 * Only the top `CONFIRMED_MATCH_WINDOW` candidates are considered (cosine order isn't spec-match
 * order, so the true sibling isn't always index 0). When more than one candidate in that window
 * qualifies, the category with the most qualifying candidates wins (ties broken by similarity) —
 * catches both "the nearest one just misses the gate" and "the catalog has more than one
 * confirmed item with this exact spec, possibly in different categories."
 */
export function pickConfirmedMatch(
  target: { canonicalName: string; unit: string | null },
  candidates: ConfirmedMatchCandidate[],
  threshold: number,
): { categoryId: string; confidence: number; matchedId: string; matchedCanonicalName: string } | null {
  const qualifying = candidates.slice(0, CONFIRMED_MATCH_WINDOW).filter((c) => {
    const unitOk = target.unit === null || c.unit === target.unit;
    return c.similarity >= threshold && unitOk && sameSpec(target.canonicalName, c.canonicalName);
  });
  if (qualifying.length === 0) return null;

  const byCategory = new Map<string, ConfirmedMatchCandidate[]>();
  for (const c of qualifying) {
    const list = byCategory.get(c.categoryId);
    if (list) list.push(c);
    else byCategory.set(c.categoryId, [c]);
  }

  let winner: ConfirmedMatchCandidate[] = [];
  let winnerMaxSimilarity = -1;
  for (const list of byCategory.values()) {
    const maxSimilarity = Math.max(...list.map((c) => c.similarity));
    if (list.length > winner.length || (list.length === winner.length && maxSimilarity > winnerMaxSimilarity)) {
      winner = list;
      winnerMaxSimilarity = maxSimilarity;
    }
  }

  const best = winner.reduce((a, b) => (b.similarity > a.similarity ? b : a));
  return {
    categoryId: best.categoryId,
    confidence: best.similarity,
    matchedId: best.id,
    matchedCanonicalName: best.canonicalName,
  };
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
