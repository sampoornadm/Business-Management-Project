import type { ImportVendorItemTagsSkippedRow } from "@bmp/types";
import ExcelJS from "exceljs";

import { BadRequestError } from "../../core/errors/HttpErrors.js";

export interface ParsedVendorItemTagRow {
  row: number;
  vendorName: string;
  itemType: string;
  make?: string;
}

export interface ParsedVendorItemTagsFile {
  rows: ParsedVendorItemTagRow[];
  skipped: ImportVendorItemTagsSkippedRow[];
}

const COLUMN_ALIASES: Record<string, "vendorName" | "itemType" | "make"> = {
  "vendor name": "vendorName",
  vendor: "vendorName",
  "item type": "itemType",
  itemtype: "itemType",
  type: "itemType",
  make: "make",
  brand: "make",
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value) return String(value.text).trim();
    if ("richText" in value) return value.richText.map((fragment) => fragment.text).join("").trim();
    if ("result" in value) return cellToString(value.result ?? null);
  }
  return String(value).trim();
}

// Expected columns (case-insensitive, any order): "Vendor Name", "Item Type",
// "Make" (optional). Only .xlsx is supported — same convention as the
// existing BOQ import (boq.parser.ts): legacy .xls needs saving as .xlsx.
export async function parseVendorItemTagsFile(buffer: Buffer): Promise<ParsedVendorItemTagsFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new BadRequestError("The uploaded workbook has no worksheets");

  const columnsByIndex: Partial<Record<number, "vendorName" | "itemType" | "make">> = {};
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const normalized = cellToString(cell.value).toLowerCase();
    const field = COLUMN_ALIASES[normalized];
    if (field) columnsByIndex[colNumber] = field;
  });

  if (!Object.values(columnsByIndex).includes("vendorName") || !Object.values(columnsByIndex).includes("itemType")) {
    throw new BadRequestError(
      'The uploaded file must have "Vendor Name" and "Item Type" columns (an optional "Make" column is also supported).',
    );
  }

  const rows: ParsedVendorItemTagRow[] = [];
  const skipped: ImportVendorItemTagsSkippedRow[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const values: Partial<Record<"vendorName" | "itemType" | "make", string>> = {};
    Object.entries(columnsByIndex).forEach(([colNumber, field]) => {
      if (!field) return;
      values[field] = cellToString(row.getCell(Number(colNumber)).value);
    });

    const vendorName = values.vendorName ?? "";
    const itemType = values.itemType ?? "";
    if (!vendorName && !itemType) continue; // blank row

    if (!vendorName || !itemType) {
      skipped.push({
        row: rowNumber,
        vendorName: vendorName || "(blank)",
        reason: !vendorName ? "Missing vendor name" : "Missing item type",
      });
      continue;
    }

    rows.push({ row: rowNumber, vendorName, itemType, make: values.make || undefined });
  }

  return { rows, skipped };
}
