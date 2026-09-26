export interface HsnMatchCandidate {
  code: string;
  description: string;
}

/**
 * The model is handed a closed list of real, ANN-retrieved HSN headings and MUST return one of
 * their codes, or null. Same "classifies, never defines the vocabulary" rule as
 * items.helpers.ts#parseClassification — this is what makes fabricating a real-but-wrong-chapter
 * code (7310/7318/7321/... for a pipe fitting — the bug this module exists to fix) structurally
 * impossible: the model can only choose among codes actually retrieved as semantically close to
 * this item by the embedding search over real CBIC descriptions.
 */
export function buildHsnMatchPrompt(
  description: string,
  unit: string | null,
  candidates: HsnMatchCandidate[],
): string {
  const options = candidates.map((c) => `  - ${c.code}: ${c.description}`).join("\n");
  return [
    "You classify a construction procurement line item into an Indian HSN (customs tariff)",
    "heading. Choose the single best-fitting heading from the list below — these are the only",
    "real headings retrieved as plausible matches for this item. Never invent a code that isn't",
    "in this list.",
    "",
    `Item description: "${description}"`,
    `Item unit: ${unit ?? "unknown"}`,
    "",
    "Candidate HSN headings:",
    options,
    "",
    'Return JSON only: { "hsnCode": "<one 4-digit code from the list above, or null if none genuinely fit>" }',
  ].join("\n");
}

export function parseHsnMatch(raw: unknown, candidateCodes: Set<string>): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = (raw as Record<string, unknown>).hsnCode;
  const code = typeof candidate === "string" ? candidate.trim() : "";
  return candidateCodes.has(code) ? code : null;
}
