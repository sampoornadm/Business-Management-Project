import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildQuoteSheet, parseQuoteSheet } from "../quote-sheet.js";

const ROWS = [
  { rfqItemId: "item-1", description: "XLPE Cable 4C x16", unit: "m", quantity: 100 },
  { rfqItemId: "item-2", description: "XLPE Cable 4C x25", unit: "m", quantity: 50 },
];

// Column letters: A=rfqItemId (hidden), B=Item Code, C=Description, D=Unit, E=Qty,
// F=Rate, G=Make, H=Model, I=Regret, J=Remarks. Row 1 is the header, so data starts at row 2.
async function fill(edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteSheet("RFQ-1", ROWS));
  edit(wb.worksheets[0]!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("quote sheet", () => {
  it("round-trips a filled rate with make and model", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell("F2").value = 152.5;
      sheet.getCell("G2").value = "Polycab";
      sheet.getCell("H2").value = "FRLS-16";
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rfqItemId: "item-1",
      rate: 152.5,
      regretted: false,
      make: "Polycab",
      model: "FRLS-16",
    });
  });

  it("reads Regret=Y as a regret with no rate, ignoring any rate in the row", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell("F2").value = 999; // must be ignored
      sheet.getCell("I2").value = "Y";
    });

    const { rows } = await parseQuoteSheet(buffer);

    expect(rows[0]).toMatchObject({ rfqItemId: "item-1", rate: null, regretted: true });
  });

  it("skips an untouched row rather than storing it as a rate of 0", async () => {
    const { rows, errors } = await parseQuoteSheet(await fill(() => {}));

    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports an unknown rfqItemId instead of guessing which item it meant", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell("A2").value = "";
      sheet.getCell("F2").value = 10;
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(rows).toEqual([]);
    expect(errors[0]).toContain("row 2");
  });

  it("builds a sheet for an RFQ title containing characters Excel forbids", async () => {
    // Real titles come from tender titles, e.g. "MJ/C06/2025/2395-PU TUBE". ExcelJS throws
    // on : \ / ? * [ ] in a sheet name rather than sanitising it.
    const buffer = await buildQuoteSheet("MJ/C06/2025/2395-PU TUBE [rev2]", ROWS);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const name = wb.worksheets[0]!.name;

    expect(name).not.toMatch(/[:\\/?*[\]]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });
});
