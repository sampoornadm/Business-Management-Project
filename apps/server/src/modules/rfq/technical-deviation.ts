/**
 * Whole answers that only mean "no deviation". Matched against the entire text (lower-cased, outer
 * punctuation/whitespace stripped) — never a prefix, so a real deviation that starts with "No"
 * ("No ISI mark on supplied make") is kept. Keep in sync with the backfill in migration
 * 20261112000000_submission_history.
 */
const NO_DEVIATION = new Set([
  "",
  "no",
  "na",
  "n/a",
  "n.a",
  "nil",
  "nill",
  "none",
  "-",
  "--",
  "not applicable",
  "nd",
  "no deviation",
  "no deviations",
  "no deviation from spec",
  "no deviation from specs",
  "no deviation from specification",
  "no deviation from specifications",
]);

const OUTER_NOISE = /^[\s.,;:!]+|[\s.,;:!]+$/g;

/** A vendor's technical deviation as stored: null when there is none, else the trimmed text. */
export function normalizeTechnicalDeviation(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return NO_DEVIATION.has(trimmed.replace(OUTER_NOISE, "").toLowerCase()) ? null : trimmed;
}
