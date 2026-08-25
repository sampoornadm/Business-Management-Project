import ExcelJS from "exceljs";

import { buildAddressLine, type RfrDocumentData } from "./rfq-document.js";

/**
 * Column layout. Export and import MUST agree, which is why both live in this file.
 * Column A holds the rfqItemId and is hidden: rows are matched back by id, never by
 * description. Descriptions run 140-180 chars and vendors edit them freely, so any
 * text-based match would silently attach a rate to the wrong item.
 */
const COLUMNS = [
  { header: "rfqItemId", key: "rfqItemId", width: 38 },
  { header: "Item Code", key: "itemCode", width: 16 },
  { header: "Description", key: "description", width: 60 },
  { header: "Unit", key: "unit", width: 10 },
  { header: "Qty", key: "quantity", width: 10 },
  { header: "Instructions", key: "instructions", width: 30 },
  { header: "Rate", key: "rate", width: 14 },
  { header: "Make", key: "make", width: 18 },
  { header: "Model", key: "model", width: 18 },
  { header: "Regret (Y/N)", key: "regret", width: 14 },
  { header: "Remarks", key: "remarks", width: 30 },
] as const;

// A fixed-size business/RFQ header block above the item table, so the number of rows to
// skip on import never depends on which fields happen to be present — an RFQ with no
// instructions still reserves the row, just blank.
const BUSINESS_NAME_ROW = 1;
const BUSINESS_ADDRESS_ROW = 2;
const RFQ_META_ROW = 3;
const INSTRUCTIONS_ROW = 4;
// Row 5 is a blank spacer.
export const ITEM_TABLE_HEADER_ROW = 6;

// Column positions (1-based). parseQuoteSheet reads by number, not by ExcelJS column key —
// a workbook reloaded from bytes (the vendor's filled-in upload) does not retain the key
// mapping set at write time, only genuine column position and row number.
const COL_RFQ_ITEM_ID = 1;
const COL_RATE = 7;
const COL_MAKE = 8;
const COL_MODEL = 9;
const COL_REGRET = 10;
const COL_REMARKS = 11;

export interface ParsedQuoteRow {
  rfqItemId: string;
  rate: number | null;
  regretted: boolean;
  make?: string;
  model?: string;
  remarks?: string;
}

export interface ParsedQuoteSheet {
  rows: ParsedQuoteRow[];
  errors: string[];
}

/**
 * Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars; ExcelJS throws
 * rather than sanitising. RFQ titles here derive from tender titles like
 * "MJ/C06/2025/2395-PU TUBE", so passing one through unfiltered is a crash, not an edge case.
 */
function toSheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31);
  return cleaned || "Quotes";
}

export async function buildQuoteSheet(data: RfrDocumentData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(toSheetName(data.rfqTitle));
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  const nameRow = sheet.addRow([data.businessName]);
  nameRow.font = { bold: true, size: 14 };

  sheet.addRow([buildAddressLine(data.businessAddress, data.businessGstNumber)]);

  const metaLine = [
    `RFQ: ${data.rfqTitle}`,
    data.tenderNumber ? `Tender Ref: ${data.tenderNumber}` : null,
    data.dueDate ? `Due Date: ${data.dueDate}` : null,
  ]
    .filter(Boolean)
    .join("   ");
  sheet.addRow([metaLine]);

  sheet.addRow([data.instructions ? `Instructions: ${data.instructions}` : ""]);
  sheet.addRow([]); // spacer

  for (const row of [BUSINESS_NAME_ROW, BUSINESS_ADDRESS_ROW, RFQ_META_ROW, INSTRUCTIONS_ROW]) {
    sheet.mergeCells(row, 1, row, COLUMNS.length);
  }

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };

  for (const item of data.items) {
    sheet.addRow({
      rfqItemId: item.rfqItemId,
      description: item.description,
      unit: item.unit ?? "",
      quantity: item.quantity,
      instructions: item.instructions ?? "",
    });
  }

  sheet.getColumn("rfqItemId").hidden = true;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function text(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value).trim();
}

export async function parseQuoteSheet(buffer: Buffer): Promise<ParsedQuoteSheet> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's load() types its param as its own Buffer; a Node Buffer clashes under the
  // repo's @types/node. Same cast boq.parser.ts / vendor-item-tags.parser.ts use.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: ["The workbook has no sheets"] };

  // The header block is normally at a fixed row, but a vendor can delete rows above it
  // (e.g. the business-name row) before re-uploading, shifting everything up. Falling back
  // to a full scan for the "rfqItemId" header text avoids silently importing 0 rows in that
  // case — see Finding 2 in the RFR final review.
  let headerRow = ITEM_TABLE_HEADER_ROW;
  let headerFound = text(sheet.getRow(ITEM_TABLE_HEADER_ROW).getCell(COL_RFQ_ITEM_ID)) === "rfqItemId";
  if (!headerFound) {
    for (let n = 1; n <= sheet.rowCount; n++) {
      if (text(sheet.getRow(n).getCell(COL_RFQ_ITEM_ID)) === "rfqItemId") {
        headerRow = n;
        headerFound = true;
        break;
      }
    }
  }
  if (!headerFound) {
    return { rows: [], errors: ["column A (rfqItemId) is missing — re-download the quote sheet"] };
  }

  const rows: ParsedQuoteRow[] = [];
  const errors: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;

    const rfqItemId = text(row.getCell(COL_RFQ_ITEM_ID));
    const rateText = text(row.getCell(COL_RATE));
    const regretted = text(row.getCell(COL_REGRET)).toUpperCase().startsWith("Y");

    // An untouched row is not an answer. Storing it would be inventing a rate of 0.
    if (!regretted && rateText === "") return;

    if (!rfqItemId) {
      errors.push(`row ${rowNumber}: missing rfqItemId — do not delete or reorder column A`);
      return;
    }

    let rate: number | null = null;
    if (!regretted) {
      const parsed = Number(rateText);
      if (Number.isNaN(parsed) || parsed < 0) {
        errors.push(`row ${rowNumber}: "${rateText}" is not a valid rate`);
        return;
      }
      rate = parsed;
    }

    const make = text(row.getCell(COL_MAKE));
    const model = text(row.getCell(COL_MODEL));
    const remarks = text(row.getCell(COL_REMARKS));

    rows.push({
      rfqItemId,
      rate,
      regretted,
      ...(make ? { make } : {}),
      ...(model ? { model } : {}),
      ...(remarks ? { remarks } : {}),
    });
  });

  return { rows, errors };
}
