import path from "node:path";

import { logger } from "../../shared/logger/logger.js";

import type { LookupRow } from "./hsn-gst-lookup.js";
import { readLookupSheet } from "./hsn-gst-lookup.reader.js";
import type { IReferenceDataRepository, TaxonomyNodeInput } from "./reference-data.repository.js";

/**
 * Where the lookup sheet lives, relative to the repository root. The user edits this file in place
 * and presses Update on the Settings page — it is deliberately a known path on disk, not an upload.
 */
export const LOOKUP_SHEET_RELATIVE_PATH = "ml/data/hsn-gst-lookup.xlsx";

export interface TaxonomyImportResult {
  rowsRead: number;
  chaptersCreated: number;
  headingsCreated: number;
  updated: number;
  legacyDeactivated: number;
  ratesApplied: number;
}

/**
 * Rebuilds the item category taxonomy and the HSN GST rates from ml/data/hsn-gst-lookup.xlsx.
 *
 * The taxonomy IS the tariff: a chapter is a top-level category, a 4-digit heading is a leaf, and a
 * leaf's code is the item's HSN code. That is the point of deriving it this way — classifying an
 * item and finding its HSN code stop being two separate guesses.
 */
export class HsnTaxonomyImportService {
  constructor(private readonly referenceDataRepository: IReferenceDataRepository) {}

  /** Absolute path to the sheet, resolved from the repo root. */
  static resolveSheetPath(repoRoot: string): string {
    return path.join(repoRoot, LOOKUP_SHEET_RELATIVE_PATH);
  }

  async importFromSheet(filePath: string): Promise<TaxonomyImportResult> {
    const rows = await readLookupSheet(filePath);

    const sync = await this.referenceDataRepository.syncTaxonomy(toTaxonomyNodes(rows));

    // Headings carry the rate that matters — a chapter row is only a grouping, and writing its rate
    // onto hsn_codes would claim a 2-digit chapter is a billable code.
    const ratesApplied = await this.referenceDataRepository.setHsnGstRates(
      rows
        .filter((row) => row.level === "heading")
        .map((row) => ({
          code: row.code,
          gstRate: row.gstRate > 0 || row.rateSource !== "unset" ? row.gstRate : null,
          source: row.rateSource,
        })),
    );

    const result: TaxonomyImportResult = { rowsRead: rows.length, ...sync, ratesApplied };
    logger.info(result, "Imported HSN taxonomy and GST rates from lookup sheet");
    return result;
  }
}

/**
 * Sheet rows -> Category nodes. Sort order follows the tariff's own numeric order so pickers read
 * like the tariff book rather than alphabetically.
 */
export function toTaxonomyNodes(rows: LookupRow[]): TaxonomyNodeInput[] {
  const ordered = [...rows].sort((a, b) => a.code.localeCompare(b.code));

  return ordered.map((row, index) => ({
    code: row.code,
    level: row.level,
    parentCode: row.parentCode,
    name: row.displayName,
    officialDescription: row.officialDescription,
    gstRate: row.rateSource === "unset" && row.gstRate === 0 ? null : row.gstRate,
    active: row.active,
    sortOrder: index,
  }));
}
