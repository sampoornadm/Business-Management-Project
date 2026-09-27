/**
 * Shape and parsing rules for ml/data/hsn-gst-lookup.xlsx — the single source of truth for the item
 * category tree, HSN codes and GST rates.
 *
 * Pure functions only: the sheet is read by a script (to generate it) and by the rebuild worker (to
 * import it), and both need the same column names and the same display-name rule.
 */

export const LOOKUP_SHEET_NAME = "HSN_GST_LOOKUP";

/** Columns the user owns. Regeneration refreshes everything else and preserves these. */
export const USER_EDITABLE_COLUMNS = [
  "display_name",
  "gst_rate",
  "rate_source",
  "active",
  "trade_terms",
] as const;

export type LookupLevel = "chapter" | "heading";

export interface LookupRow {
  code: string;
  level: LookupLevel;
  /** Chapter code for a heading; empty for a chapter. */
  parentCode: string;
  officialDescription: string;
  displayName: string;
  gstRate: number;
  rateSource: string;
  effectiveFrom: string;
  active: boolean;
  /** Real-world names for this code, as stored in the sheet: "disc spring; Belleville washer". */
  tradeTerms: string[];
}

/** Maximum length of a generated display name, so category pickers stay readable. */
const DISPLAY_NAME_MAX = 60;

/**
 * Below this a label stops identifying anything — "Screws", "Table", "Insulated" are all real
 * first-clauses from the tariff, and all useless on their own in a list of 1,379 entries.
 */
const DISPLAY_NAME_MIN = 18;

/** Clause boundaries, in the order a tariff description tends to use them. */
const BOUNDARIES = [";", " : ", ":", ", "];

/**
 * Turns tariff prose into a dropdown label.
 *
 * CBIC descriptions run to 1,210 characters (avg 117) and are shouted, e.g.
 * "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL".
 * Parenthetical digressions are dropped, then the leading clause is taken — but extended through
 * further boundaries while it is still too short to identify anything, because plenty of headings
 * open with a bare enumeration ("SCREWS, BOLTS, NUTS, ...").
 */
export function deriveDisplayName(description: string, maxLength = DISPLAY_NAME_MAX): string {
  const clean = description
    .replace(/\([^)]*\)/g, " ") // "INSULATED (INCLUDING ENAMELLED...) WIRE" -> "INSULATED WIRE"
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .trim();
  if (!clean) return "";

  let head = trimPunctuation(takeClause(clean, maxLength));
  if (!head) head = clean;

  if (head.length > maxLength) {
    const cut = head.lastIndexOf(" ", maxLength);
    head = trimPunctuation(head.slice(0, cut > DISPLAY_NAME_MIN ? cut : maxLength));
  }

  const lower = head.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The shortest leading clause that is still meaningful: cut at the earliest boundary, and keep
 * moving to the next one while the result is under DISPLAY_NAME_MIN and still fits.
 */
function takeClause(text: string, maxLength: number): string {
  const cuts: number[] = [];
  for (const boundary of BOUNDARIES) {
    // Every occurrence, not just the first — "SCREWS, BOLTS, NUTS, ..." needs the third comma.
    for (let at = text.indexOf(boundary); at > 0; at = text.indexOf(boundary, at + 1)) {
      cuts.push(at);
    }
  }
  cuts.sort((a, b) => a - b);

  for (const at of cuts) {
    if (at >= DISPLAY_NAME_MIN || at > maxLength) return text.slice(0, at);
  }
  return cuts.length > 0 ? text.slice(0, cuts[cuts.length - 1]!) : text;
}

function trimPunctuation(value: string): string {
  return value.replace(/[\s,:;.\-–]+$/, "").trim();
}

/** "disc spring; Belleville washer;;  cup spring " -> ["disc spring", "Belleville washer", "cup spring"] */
export function parseTradeTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((term) => term.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function serializeTradeTerms(terms: string[]): string {
  return terms.join("; ");
}

/**
 * Spreadsheet cells are whatever the user typed. Accept the obvious truthy spellings and treat
 * anything else as false, so a stray value can only ever hide a row, never silently enable one.
 */
export function parseActiveFlag(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === undefined || raw === null || raw === "") return true;
  return ["true", "yes", "y", "1"].includes(String(raw).trim().toLowerCase());
}

/** A rate is only usable if it is a real number in range; anything else must fall back, not guess. */
export function parseGstRate(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/%/g, "").trim());
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

/**
 * Disambiguates labels that collide. 15 heading descriptions repeat inside a single chapter, so the
 * label alone cannot identify a row — without this two identical entries ship in the picker.
 */
export function disambiguateDisplayNames(rows: { code: string; displayName: string }[]): Map<string, string> {
  const claimed = new Map<string, string>();
  const result = new Map<string, string>();

  for (const row of rows) {
    const key = row.displayName.toLowerCase();
    const owner = claimed.get(key);
    const name = owner && owner !== row.code ? `${row.displayName} (${row.code})` : row.displayName;
    claimed.set(key, owner ?? row.code);
    result.set(row.code, name);
  }

  return result;
}
