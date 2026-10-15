import { describe, expect, it } from "vitest";

import { parseTabularItems } from "../tender-table-items.parser.js";

const T = "\t";

// Real `extractDocumentText` output for "TnC - SPARE PARTS FOR RINK- OCTOBER.docx" — a terms
// block followed by an UNLABELLED item table (Sl | Description | Machine | Qty | photo). The
// trailing empty cells are the photo/price columns, which are empty in the issued document.
const UNLABELLED_TABLE = [
  "TERMS & CONDITIONS",
  "Location – Bata Nagar, Kolkata",
  "Payment Terms- Net45.",
  "Warranty : 24months after complete the work",
  "PI should be shared with Breakup as per below BOQ with Bata Nagar team, post auction.",
  `1${T}Pneumatic hand leaver valve for Upper testing machine.${T}Upper testing m/c.${T}2pcs.`,
  `2${T}Bucket for Toe lasting Injector cylender (18/26/5mm)${T}C/F-777MA${T}12pcs.`,
  `7${T}Fiver bush & Washer for cabin fan repairing.${T}Cabine fan- Repairing${T}100pcs. Each`,
  `9${T}Steam pipe for Heel Softner Machine.(Dia -2 inch)${T}Heel softner${T}3mtr.`,
].join("\n");

// Real output for "TnC - BEARING FOR RINK MACHINE.docx": same layout, but with no Sl No column.
const UNLABELLED_TABLE_NO_SERIAL = `Long sheft Bearing (SBU006/K006)${T}Chiller conveyor${T}3pcs.`;

// Real output for "TnC - BN - IT Accessories.docx", whose items are plain paragraphs, not a table.
const FREE_TEXT_LIST = [
  "TERMS & CONDITIONS",
  "Location – Bata Nagar, Kolkata",
  "Payment Terms- Net45.",
  "There should not be any hidden charges.-",
  "Warranty : 24months after complete the work",
  "Taxes extra.",
  "Keyboard _ Logitech MK120_Corded Keyboard & Mouse Combo – 3 sets.",
  "Mouse _ Logitech M90 Wired Mouse – 3 pcs",
  "Logitech MI 70 Wireless Mouse -2 pc",
].join("\n");

// Real output for "1-Response Quotation Form 14.xlsx" (a supplier quotation-response workbook),
// abridged to the columns that matter. Note the two EMPTY leading cells on every data row —
// the exact shape that a naive line.trim() would shift out of alignment with the header.
const QUOTATION_WORKBOOK = [
  ["Supplier Bid Currency", "Exchange Rate", "Item Code", "Label", "UPL Material Description (long text)", "Comment", "Plant / Plant code", "HSN Number", "Quantity Reqd.", "UoM", "Unit Price  (in bid currency)"],
  ["", "", "9075179", "Sealicon sealant, RT-732", "SEALICON SEALANT, RT-732", "DOWSIL RTV Silicone Sealant 732 Clear. SIZE-300ml.", "PL89/SUPERFORM CHEMISTRIES LIMITED,HALDIA.", "", "12", "Number", ""],
  ["", "", "", "Concertina coil", "", "concertina coil Material: Metal Aluminum Size:6 Meter", "PL89/SUPERFORM CHEMISTRIES LIMITED,HALDIA.", "", "6", "Number", ""],
].map((row) => row.join(T)).join("\n");

describe("parseTabularItems", () => {
  it("reads an unlabelled item table, dropping the serial number and fusing quantity + unit", () => {
    expect(parseTabularItems(UNLABELLED_TABLE)).toEqual([
      { description: "Pneumatic hand leaver valve for Upper testing machine. — Upper testing m/c.", quantity: 2, unit: "pcs" },
      { description: "Bucket for Toe lasting Injector cylender (18/26/5mm) — C/F-777MA", quantity: 12, unit: "pcs" },
      { description: "Fiver bush & Washer for cabin fan repairing. — Cabine fan- Repairing", quantity: 100, unit: "pcs" },
      { description: "Steam pipe for Heel Softner Machine.(Dia -2 inch) — Heel softner", quantity: 3, unit: "mtr" },
    ]);
  });

  it("handles an unlabelled table with no serial-number column", () => {
    expect(parseTabularItems(UNLABELLED_TABLE_NO_SERIAL)).toEqual([
      { description: "Long sheft Bearing (SBU006/K006) — Chiller conveyor", quantity: 3, unit: "pcs" },
    ]);
  });

  it("falls back to trailing-quantity paragraphs when the document has no table", () => {
    expect(parseTabularItems(FREE_TEXT_LIST)).toEqual([
      { description: "Keyboard _ Logitech MK120_Corded Keyboard & Mouse Combo", quantity: 3, unit: "sets" },
      { description: "Mouse _ Logitech M90 Wired Mouse", quantity: 3, unit: "pcs" },
      { description: "Logitech MI 70 Wireless Mouse", quantity: 2, unit: "pc" },
    ]);
  });

  it("never mistakes a terms/conditions line for an item", () => {
    const terms = ["Payment Terms- Net45.", "Warranty : 24months after complete the work", "Taxes extra."].join("\n");
    expect(parseTabularItems(terms)).toEqual([]);
  });

  it("maps a header row by column name, keeping data rows aligned despite empty leading cells", () => {
    expect(parseTabularItems(QUOTATION_WORKBOOK)).toEqual([
      {
        itemCode: "9075179",
        description: "Sealicon sealant, RT-732 — DOWSIL RTV Silicone Sealant 732 Clear. SIZE-300ml.",
        quantity: 12,
        unit: "Number",
      },
      {
        itemCode: undefined,
        description: "concertina coil Material: Metal Aluminum Size:6 Meter",
        quantity: 6,
        unit: "Number",
      },
    ]);
  });

  it("leaves quantity undefined rather than 0 when the cell is empty", () => {
    const text = [`Description${T}Qty${T}UoM`, `Anchor bolt M12${T}${T}Nos`].join("\n");
    expect(parseTabularItems(text)).toEqual([
      { itemCode: undefined, description: "Anchor bolt M12", quantity: undefined, unit: "Nos" },
    ]);
  });

  it("does not treat a money column as the unit column", () => {
    const text = [`Description${T}Quantity${T}Unit Price (INR)`, `Cable 4C x16${T}25${T}1200`].join("\n");
    expect(parseTabularItems(text)[0]).toMatchObject({ description: "Cable 4C x16", quantity: 25 });
    expect(parseTabularItems(text)[0]!.unit).toBeUndefined();
  });

  it("returns nothing for a table with no quantity anywhere", () => {
    expect(parseTabularItems(`Contracting Agency${T}IISCO Steel Plant${T}Burnpur`)).toEqual([]);
  });
});
