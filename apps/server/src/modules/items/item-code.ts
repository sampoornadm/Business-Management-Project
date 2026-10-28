/**
 * Internal item code: 11 digits, `CC SS FFFF VVV`.
 *
 *  - CC SS  the item's 4-digit HSN heading (chapter + heading), `0000` until one is known
 *  - FFFF   family serial, per business — one per `familyKey`
 *  - VVV    variant serial inside the family
 *
 * A family is "the same item with the numbers taken out", so "XLPE Cable 4C x16" and "x25" share
 * CCSSFFFF and differ only in VVV. That gives near-name lookups a deterministic, spec-aware key —
 * the embedding cannot tell those two apart (see spec-match.ts).
 */

export const ITEM_CODE_LENGTH = 11;
const UNKNOWN_HEADING = "0000";

/** canonicalName with every number removed, lowercased, punctuation and whitespace collapsed. */
export function deriveFamilyKey(canonicalName: string): string {
  return canonicalName
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First 4 digits of an HSN code or tariff heading; `0000` when there is nothing usable. */
export function headingPrefix(code: string | null | undefined): string {
  return code && /^\d{4,}/.test(code) ? code.slice(0, 4) : UNKNOWN_HEADING;
}

export function formatItemCode(prefix: string, family: number, variant: number): string {
  return `${prefix}${String(family).padStart(4, "0")}${String(variant).padStart(3, "0")}`;
}

/** Splits a stored code into its segments; null when it isn't a well-formed code. */
export function parseItemCode(code: string): { prefix: string; family: number; variant: number } | null {
  if (!new RegExp(`^\\d{${ITEM_CODE_LENGTH}}$`).test(code)) return null;
  return { prefix: code.slice(0, 4), family: Number(code.slice(4, 8)), variant: Number(code.slice(8, 11)) };
}
