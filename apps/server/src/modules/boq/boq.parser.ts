import type { BoqColumnField, BoqParsePreviewRow } from "@bmp/types";
import ExcelJS from "exceljs";
import pdfParse from "pdf-parse";

import { BadRequestError } from "../../core/errors/HttpErrors.js";

export interface ParsedBoqFile {
  columns: string[];
  suggestedMapping: Partial<Record<BoqColumnField, string>>;
  rows: BoqParsePreviewRow[];
}

const HEADER_PATTERNS: Array<[BoqColumnField, RegExp]> = [
  [
    "itemCode",
    /(item\s*code|s\.?\s*no\.?|sl\.?\s*no\.?|sr\.?\s*no\.?)$/,
  ],
  ["description", /(description|particular|item\s*name)/],
  ["category", /(category|section)/],
  ["unit", /(unit|uom)/],
  ["quantity", /(qty|quantity)/],
  ["rate", /rate/],
];

function guessMapping(headers: string[]): Partial<Record<BoqColumnField, string>> {
  const mapping: Partial<Record<BoqColumnField, string>> = {};
  for (const header of headers) {
    const normalized = header.toLowerCase().trim();
    if (normalized.includes("date")) continue;
    for (const [field, pattern] of HEADER_PATTERNS) {
      if (mapping[field]) continue;
      if (pattern.test(normalized)) {
        mapping[field] = header;
        break;
      }
    }
  }
  return mapping;
}

function cellToPrimitive(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellToPrimitive(value.result ?? null);
    if ("text" in value) return String(value.text);
    if ("richText" in value) return value.richText.map((fragment) => fragment.text).join("");
  }
  return String(value);
}

async function parseExcelBuffer(buffer: Buffer): Promise<ParsedBoqFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new BadRequestError("The uploaded workbook has no worksheets");

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim() || `Column ${colNumber}`;
  });
  if (headers.filter(Boolean).length === 0) {
    throw new BadRequestError("Could not find a header row in the uploaded file");
  }

  const rows: BoqParsePreviewRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const cells: Record<string, string | number | null> = {};
    let hasValue = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const value = cellToPrimitive(row.getCell(colNumber).value);
      cells[header] = value;
      if (value !== null && value !== "") hasValue = true;
    });
    if (hasValue) rows.push({ rowIndex: rowNumber - 1, cells });
  }

  const columns = headers.filter((h): h is string => Boolean(h));
  return { columns, suggestedMapping: guessMapping(columns), rows };
}

/**
 * PDF BOQ tables rarely extract into clean columns. Best-effort: pull raw
 * text, split into lines, land every line in a single "text" column so the
 * user finishes structuring it in the same manual-mapping/edit screen used
 * for Excel — see phase-3-boq-estimation.md's PDF scope decision.
 */
async function parsePdfBuffer(buffer: Buffer): Promise<ParsedBoqFile> {
  const data = await pdfParse(buffer);
  const lines = data.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rows: BoqParsePreviewRow[] = lines.map((line, index) => ({
    rowIndex: index + 1,
    cells: { text: line },
  }));

  return { columns: ["text"], suggestedMapping: { description: "text" }, rows };
}

export async function parseBoqFile(buffer: Buffer, mimeType: string): Promise<ParsedBoqFile> {
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return parseExcelBuffer(buffer);
  }
  if (mimeType === "application/pdf") {
    return parsePdfBuffer(buffer);
  }
  throw new BadRequestError(
    "Unsupported BOQ file type. Upload an Excel (.xlsx) or PDF file — legacy .xls is not supported, save as .xlsx first.",
  );
}
