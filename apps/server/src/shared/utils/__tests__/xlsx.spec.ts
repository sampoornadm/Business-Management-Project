import ExcelJS from "exceljs";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { cellToPrimitive, cellToText, loadWorkbook, pickDataWorksheet } from "../xlsx.js";

// The 21 whole-column ranges a real supplier "Response Quotation Form" carries. exceljs expands
// every `sqref` into one property per cell address, so these cost ~22 million properties and the
// load dies with `RangeError: Too many properties to enumerate` — the reason loadWorkbook skips
// the node. Cheap while the guard is in place; if it is ever removed, these tests are what fails.
const FULL_COLUMN_VALIDATIONS = [
  "A", "B", "G", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "X", "Y", "Z", "AA", "AB",
]
  .map(
    (column) =>
      `<dataValidation type="list" allowBlank="1" sqref="${column}2:${column}1048576"><formula1>"one,two"</formula1></dataValidation>`,
  )
  .join("");

/**
 * Rebuilds the shape of a real supplier "Response Quotation Form" workbook: template sheets
 * hidden ahead of the data grid, a one-column visible "Instructions" sheet, and whole-column data
 * validations on the grid itself. exceljs's own writer normalises validations away, so they are
 * injected into the sheet XML afterwards, exactly as the real file has them.
 */
async function buildQuotationWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const template = workbook.addWorksheet("style_rfx");
  template.state = "veryHidden";
  template.addRow(["style", "value", "extra"]);
  template.addRow(["a", "b", "c"]);

  const instructions = workbook.addWorksheet("Instructions");
  instructions.addRow(["Instructions"]);
  instructions.addRow(["Please fill in blank cells."]);

  const response = workbook.addWorksheet("Response ");
  response.addRow(["Item Code", "Label", "Quantity Reqd.", "UoM"]);
  response.addRow(["9075179", "Sealicon sealant", 12, "Number"]);

  const zip = new PizZip((await workbook.xlsx.writeBuffer()) as Buffer);
  const sheetPath = Object.keys(zip.files).find((name) => name.endsWith("worksheets/sheet3.xml"))!;
  zip.file(
    sheetPath,
    zip
      .file(sheetPath)!
      .asText()
      .replace(
        "</sheetData>",
        `</sheetData><dataValidations count="${21}">${FULL_COLUMN_VALIDATIONS}</dataValidations>`,
      ),
  );
  return zip.generate({ type: "nodebuffer" });
}

describe("loadWorkbook", () => {
  it("loads a workbook whose data validations cover whole columns", async () => {
    const workbook = await loadWorkbook(await buildQuotationWorkbook());
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain("Response ");
  });
});

describe("pickDataWorksheet", () => {
  it("skips hidden template sheets and a one-column instructions sheet", async () => {
    const workbook = await loadWorkbook(await buildQuotationWorkbook());
    expect(pickDataWorksheet(workbook)?.name).toBe("Response ");
  });

  it("still picks the first sheet for an ordinary single-sheet BOQ", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("BOQ");
    sheet.addRow(["Sl No", "Description", "Unit", "Qty"]);
    sheet.addRow([1, "Anchor bolt", "Nos", 25]);
    const reloaded = await loadWorkbook((await workbook.xlsx.writeBuffer()) as Buffer);
    expect(pickDataWorksheet(reloaded)?.name).toBe("BOQ");
  });
});

describe("cellToPrimitive / cellToText", () => {
  it("keeps numbers as numbers and reads formula results and rich text", () => {
    expect(cellToPrimitive(12)).toBe(12);
    expect(cellToPrimitive({ formula: "A1*2", result: 24 })).toBe(24);
    expect(cellToPrimitive({ richText: [{ text: "Cable " }, { text: "4C" }] })).toBe("Cable 4C");
  });

  it("returns nothing textual for an error value or an uncached formula", () => {
    expect(cellToPrimitive({ error: "#N/A" })).toBeNull();
    expect(cellToText({ error: "#N/A" })).toBe("");
  });

  it("decodes the OOXML carriage-return escape found in quotation-form spec text", () => {
    expect(cellToText("Size:6 Meter_x000d_ Diameter: 600 Mm")).toBe("Size:6 Meter  Diameter: 600 Mm");
  });
});
