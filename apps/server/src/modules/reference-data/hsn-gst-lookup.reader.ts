import ExcelJS from "exceljs";

import { BadRequestError } from "../../core/errors/HttpErrors.js";

import {
  LOOKUP_SHEET_NAME,
  parseActiveFlag,
  parseGstRate,
  parseTradeTerms,
  type LookupRow,
} from "./hsn-gst-lookup.js";

/** Columns the sheet must have for an import to be meaningful. */
const REQUIRED_COLUMNS = ["code", "level", "display_name"] as const;

/**
 * Reads ml/data/hsn-gst-lookup.xlsx into rows. Column order is not assumed — the header row is
 * matched by name, because this file is edited by hand in Excel and columns get moved.
 */
export async function readLookupSheet(filePath: string): Promise<LookupRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheet = workbook.getWorksheet(LOOKUP_SHEET_NAME);
  if (!sheet) {
    throw new BadRequestError(`Lookup sheet has no "${LOOKUP_SHEET_NAME}" worksheet.`);
  }

  const columnByName = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(cell.value ?? "").trim().toLowerCase();
    if (name) columnByName.set(name, col);
  });

  const missing = REQUIRED_COLUMNS.filter((name) => !columnByName.has(name));
  if (missing.length > 0) {
    throw new BadRequestError(`Lookup sheet is missing column(s): ${missing.join(", ")}.`);
  }

  const cellText = (row: ExcelJS.Row, name: string): string => {
    const col = columnByName.get(name);
    if (!col) return "";
    const value = row.getCell(col).value;
    if (value === null || value === undefined) return "";
    // A formula cell yields { formula, result }; the result is what was meant.
    if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
    return String(value).trim();
  };

  const rows: LookupRow[] = [];
  const seen = new Set<string>();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const code = cellText(row, "code");
    if (!code) return;
    if (seen.has(code)) {
      throw new BadRequestError(`Lookup sheet has duplicate code "${code}" (row ${rowNumber}).`);
    }
    seen.add(code);

    const level = cellText(row, "level").toLowerCase();
    if (level !== "chapter" && level !== "heading") {
      throw new BadRequestError(
        `Lookup sheet row ${rowNumber} (code ${code}) has level "${level}"; expected chapter or heading.`,
      );
    }

    // A blank label falls back to the code rather than failing the rebuild — someone clearing one
    // cell should not cost the whole taxonomy, and the code is always a usable label.
    const displayName = cellText(row, "display_name") || code;

    const col = columnByName.get("gst_rate");
    const gstRate = col ? parseGstRate(row.getCell(col).value) : null;

    rows.push({
      code,
      level,
      parentCode: level === "heading" ? cellText(row, "parent_code") || code.slice(0, 2) : "",
      officialDescription: cellText(row, "official_description"),
      displayName,
      // A blank or unparseable rate is not a reason to refuse the whole import; the row simply
      // carries no rate and downstream falls back rather than inventing one.
      gstRate: gstRate ?? 0,
      rateSource: cellText(row, "rate_source") || "unset",
      effectiveFrom: cellText(row, "effective_from"),
      active: parseActiveFlag(columnByName.has("active") ? cellText(row, "active") : ""),
      tradeTerms: parseTradeTerms(cellText(row, "trade_terms")),
    });
  });

  if (rows.length === 0) {
    throw new BadRequestError("Lookup sheet has no data rows.");
  }

  const orphans = rows.filter(
    (r) => r.level === "heading" && !rows.some((c) => c.level === "chapter" && c.code === r.parentCode),
  );
  if (orphans.length > 0) {
    const sample = orphans.slice(0, 5).map((o) => o.code).join(", ");
    throw new BadRequestError(
      `Lookup sheet has ${orphans.length} heading(s) whose chapter is missing (e.g. ${sample}).`,
    );
  }

  return rows;
}
