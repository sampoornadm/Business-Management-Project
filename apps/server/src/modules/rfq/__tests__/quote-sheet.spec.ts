import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { RfrDocumentData } from "../rfq-document.js";
import { buildQuoteSheet, ITEM_TABLE_HEADER_ROW, parseQuoteSheet } from "../quote-sheet.js";

const DATA: RfrDocumentData = {
  businessName: "Archie Udyog",
  businessAddress: "Pune, MH",
  businessGstNumber: "27AAAAA0000A1Z5",
  rfqTitle: "RFQ-1",
  tenderNumber: null,
  dueDate: null,
  instructions: null,
  items: [
    { rfqItemId: "item-1", description: "XLPE Cable 4C x16", unit: "m", quantity: 100, instructions: null },
    { rfqItemId: "item-2", description: "XLPE Cable 4C x25", unit: "m", quantity: 50, instructions: null },
  ],
};

const FIRST_ITEM_ROW = ITEM_TABLE_HEADER_ROW + 1;

// Column letters, fixed regardless of the business-header rows above: A=rfqItemId (hidden),
// B=Item Code, C=Description, D=Unit, E=Qty, F=Instructions, G=Rate, H=Make, I=Model,
// J=Regret, K=Remarks. Data starts at ITEM_TABLE_HEADER_ROW + 1.
async function fill(edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteSheet(DATA));
  edit(wb.worksheets[0]!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("quote sheet", () => {
  it("round-trips a filled rate with make and model", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 152.5;
      sheet.getCell(`H${FIRST_ITEM_ROW}`).value = "Polycab";
      sheet.getCell(`I${FIRST_ITEM_ROW}`).value = "FRLS-16";
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
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 999; // must be ignored
      sheet.getCell(`J${FIRST_ITEM_ROW}`).value = "Y";
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
      sheet.getCell(`A${FIRST_ITEM_ROW}`).value = "";
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 10;
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(rows).toEqual([]);
    expect(errors[0]).toContain(`row ${FIRST_ITEM_ROW}`);
  });

  it("still imports rates when rows above the header block are deleted (header shifts up)", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 152.5;
      // A vendor deleting the business-name/address/meta/instructions/spacer rows before
      // re-uploading shifts everything up by 5 — the header that was at ITEM_TABLE_HEADER_ROW
      // (6) is now at row 1. parseQuoteSheet must find it via its full-sheet scan fallback
      // rather than silently returning 0 rows because row 6 no longer holds the header.
      sheet.spliceRows(1, 5);
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rfqItemId: "item-1", rate: 152.5, regretted: false });
  });

  it("returns an explicit error when the header row is nowhere in the sheet", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`A${ITEM_TABLE_HEADER_ROW}`).value = "";
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(rows).toEqual([]);
    expect(errors).toEqual(["column A (rfqItemId) is missing — re-download the quote sheet"]);
  });

  it("builds a sheet for an RFQ title containing characters Excel forbids", async () => {
    // Real titles come from tender titles, e.g. "MJ/C06/2025/2395-PU TUBE". ExcelJS throws
    // on : \ / ? * [ ] in a sheet name rather than sanitising it.
    const buffer = await buildQuoteSheet({ ...DATA, rfqTitle: "MJ/C06/2025/2395-PU TUBE [rev2]" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const name = wb.worksheets[0]!.name;

    expect(name).not.toMatch(/[:\\/?*[\]]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("writes the business header and instructions above the item table", async () => {
    const buffer = await buildQuoteSheet({
      ...DATA,
      instructions: "Deliver within 15 days",
      tenderNumber: "TND-0001",
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0]!;

    expect(sheet.getCell("A1").value).toBe("Archie Udyog");
    expect(String(sheet.getCell("A3").value)).toContain("TND-0001");
    expect(String(sheet.getCell("A4").value)).toContain("Deliver within 15 days");
    expect(sheet.getCell(`A${ITEM_TABLE_HEADER_ROW}`).value).toBe("rfqItemId");
  });
});
