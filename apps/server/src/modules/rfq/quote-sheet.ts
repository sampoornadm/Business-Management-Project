import ExcelJS from "exceljs";

/**
 * Column layout. Export and import MUST agree, which is why both live in this file.
 * Column A holds the rfqItemId and is hidden: rows are matched back by id, never by
 * description. Descriptions run 140-180 chars and vendors edit them freely, so any
 * text-based match would silently attach a rate to the wrong item.
 */
const COLUMNS = [
  { header: "rfqItemId", key: "rfqItemId", width: 38, hidden: true },
  { header: "Item Code", key: "itemCode", width: 16 },
  { header: "Description", key: "description", width: 60 },
  { header: "Unit", key: "unit", width: 10 },
  { header: "Qty", key: "quantity", width: 10 },
  { header: "Rate", key: "rate", width: 14 },
  { header: "Make", key: "make", width: 18 },
  { header: "Model", key: "model", width: 18 },
  { header: "Regret (Y/N)", key: "regret", width: 14 },
  { header: "Remarks", key: "remarks", width: 30 },
] as const;

const HEADER_ROW = 1;

export interface QuoteSheetRow {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
}

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

export async function buildQuoteSheet(rfqTitle: string, rows: QuoteSheetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(toSheetName(rfqTitle));
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getColumn("rfqItemId").hidden = true;
  sheet.getRow(HEADER_ROW).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      rfqItemId: row.rfqItemId,
      description: row.description,
      unit: row.unit ?? "",
      quantity: row.quantity,
    });
  }

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

  const rows: ParsedQuoteRow[] = [];
  const errors: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === HEADER_ROW) return;

    const rfqItemId = text(row.getCell(1));
    const rateText = text(row.getCell(6));
    const regretted = text(row.getCell(9)).toUpperCase().startsWith("Y");

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

    const make = text(row.getCell(7));
    const model = text(row.getCell(8));
    const remarks = text(row.getCell(10));

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
