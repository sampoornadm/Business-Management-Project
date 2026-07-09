import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { BadRequestError } from "../../../core/errors/HttpErrors.js";
import { parseVendorItemTagsFile } from "../vendor-item-tags.parser.js";

async function buildWorkbook(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tags");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseVendorItemTagsFile", () => {
  it("parses well-formed rows, including the optional Make column", async () => {
    const buffer = await buildWorkbook([
      ["Vendor Name", "Item Type", "Make"],
      ["Ace Steel Suppliers", "FLANGE", "ACME"],
      ["Beta Traders", "GASKET", ""],
    ]);

    const result = await parseVendorItemTagsFile(buffer);

    expect(result.rows).toEqual([
      { row: 2, vendorName: "Ace Steel Suppliers", itemType: "FLANGE", make: "ACME" },
      { row: 3, vendorName: "Beta Traders", itemType: "GASKET", make: undefined },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("reports rows missing a required column as skipped, not as parsed rows", async () => {
    const buffer = await buildWorkbook([
      ["Vendor Name", "Item Type"],
      ["Ace Steel Suppliers", "FLANGE"],
      ["", "GASKET"],
      ["Beta Traders", ""],
    ]);

    const result = await parseVendorItemTagsFile(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([
      { row: 3, vendorName: "(blank)", reason: "Missing vendor name" },
      { row: 4, vendorName: "Beta Traders", reason: "Missing item type" },
    ]);
  });

  it("matches columns case-insensitively and in any order", async () => {
    const buffer = await buildWorkbook([
      ["item type", "vendor name"],
      ["FLANGE", "Ace Steel Suppliers"],
    ]);

    const result = await parseVendorItemTagsFile(buffer);

    expect(result.rows).toEqual([
      { row: 2, vendorName: "Ace Steel Suppliers", itemType: "FLANGE", make: undefined },
    ]);
  });

  it("rejects a workbook missing the required columns", async () => {
    const buffer = await buildWorkbook([["Foo", "Bar"]]);

    await expect(parseVendorItemTagsFile(buffer)).rejects.toBeInstanceOf(BadRequestError);
  });
});
