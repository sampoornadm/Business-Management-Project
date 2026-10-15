import ExcelJS from "exceljs";

/**
 * exceljs expands a data-validation's `sqref` into one property per cell address. Real supplier
 * quotation workbooks apply list/decimal validations to WHOLE columns (`sqref="A2:A1048576"`),
 * so that expansion throws `RangeError: Too many properties to enumerate` and the entire load
 * fails — confirmed on three real "Response Quotation Form" workbooks, which every xlsx path in
 * this app (BOQ upload, tender extraction) would otherwise 500 on. Nothing here reads
 * validations, so skip the node outright.
 */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer, { ignoreNodes: ["dataValidations"] });
  return workbook;
}

function headerCellCount(worksheet: ExcelJS.Worksheet): number {
  let count = 0;
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
    if (String(cell.value ?? "").trim()) count += 1;
  });
  return count;
}

/**
 * `worksheets[0]` is not necessarily the data sheet: a supplier quotation workbook carries eight
 * hidden/veryHidden template sheets plus a one-column "Instructions" sheet ahead of the visible
 * item grid. Deliberately conservative — the FIRST visible sheet that looks like a table wins, so
 * an ordinary single-sheet BOQ resolves exactly as before.
 */
export function pickDataWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  const visible = workbook.worksheets.filter((worksheet) => worksheet.state === "visible");
  const candidates = visible.length > 0 ? visible : workbook.worksheets;
  return (
    candidates.find((worksheet) => worksheet.rowCount >= 2 && headerCellCount(worksheet) >= 2) ??
    candidates[0]
  );
}

/** exceljs cell values are a union of primitives, dates, formula results, hyperlinks and rich text. */
export function cellToPrimitive(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((fragment) => fragment.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellToPrimitive(value.result ?? null);
    // A formula with no cached result, an error value (#N/A) or an embedded image carries no
    // text — previously these stringified to a literal "[object Object]" in the cell.
    return null;
  }
  return String(value);
}

export function cellToText(value: ExcelJS.CellValue): string {
  const primitive = cellToPrimitive(value);
  // `_x000D_` is OOXML's escape for a carriage return inside a shared string; exceljs hands it
  // back raw, and supplier quotation forms are full of them inside multi-line spec text.
  return primitive === null ? "" : String(primitive).replace(/_x000[Dd]_/g, " ");
}
