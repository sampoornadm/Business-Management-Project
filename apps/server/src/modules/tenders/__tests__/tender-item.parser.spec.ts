import { describe, expect, it } from "vitest";

import { parseIiscoRfqItems } from "../tender-item.parser.js";

// Fixtures below mirror the exact structure of pdf-parse's real raw-text
// output for IISCO/SAIL RFQ Item Details tables (verified directly against
// several real sample documents) — labels and values run together with no
// separators because the PDF content stream isn't in visual reading order.
const SINGLE_ITEM_TEXT = `RFQ Item Details
RFQ Description :
Procurement of PU TUBE
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171301005600045         250.000 M11.04.2026
Material Long Description
:
TUBE  MATERIAL                       : POLYURETHANE WORKING
PRESSURE               : 10 BAR SIZE                           :
ID 4 X OD 6 MM   COLOR: BLUE, TEMPERATURE: 5 TO 60 DEG C,
HARDNESS: SHORE A98
Item Additional
Description:
***************This is an electronically generated RFX requires no signature***************`;

// Simulates two items straddling a PDF page boundary: the recurring
// page header/footer boilerplate lands between the anchor line and the
// item's data line for item 2.
const MULTI_ITEM_WITH_PAGE_BREAK_TEXT = `RFQ Item Details
RFQ Description :
O-RING ASSORTMENT
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171804001603827 50.000 EA28.03.2026
Material Long Description
:
O-RING ID 94.92 X C/S 2.62 MM; MOC : ACRYLONITRILE-BUTADIENERUBBER (NBR)
Item Additional
Description:
Sl NoItem CodeQtyUoMExpected Delivery
Date

ISP MATERIAL MANAGEMENT DEPARTMENT
Amendment Date:Amendment No:
Contracting Agency:02.01.2026TE Date:
MJ/C07/2025/2474
1400012649
RFQ Title:
TE No:
IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)
      Page 4 / 9
 271804001603839 100.000 EA28.03.2026
Material Long Description
:
O-RING ID 116.8 X C/S 5.34 MM; MOC : FLUOROCARBON RUBBER (FKM)
Item Additional
Description:`;

describe("parseIiscoRfqItems", () => {
  it("extracts a single item with exact item code, quantity, and unit", () => {
    const items = parseIiscoRfqItems(SINGLE_ITEM_TEXT);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      itemCode: "71301005600045",
      description: "TUBE MATERIAL : POLYURETHANE WORKING PRESSURE : 10 BAR SIZE : ID 4 X OD 6 MM COLOR: BLUE, TEMPERATURE: 5 TO 60 DEG C, HARDNESS: SHORE A98",
      quantity: 250,
      unit: "M",
    });
  });

  it("correctly parses an item whose data line is split by page-boundary boilerplate", () => {
    const items = parseIiscoRfqItems(MULTI_ITEM_WITH_PAGE_BREAK_TEXT);

    expect(items).toHaveLength(2);
    expect(items[0]!.itemCode).toBe("71804001603827");
    expect(items[1]!.itemCode).toBe("71804001603839");
    expect(items[1]!.quantity).toBe(100);
    expect(items[1]!.unit).toBe("EA");
  });

  it("returns an empty array for text with no item table", () => {
    const items = parseIiscoRfqItems("This is a plain Word document with no tender item table at all.");

    expect(items).toEqual([]);
  });

  it("strips page boilerplate whose footer has no page-count yet (\"Page N / *\")", () => {
    // Verified against examples/BID1400013656.PDF: pages before the total
    // page count is known render "Page 2 / *" instead of "Page 2 / 13" —
    // the boilerplate must still be stripped or the next item's row fails
    // to match at all.
    const text = `RFQ Item Details
RFQ Description :
Procurement of FLANGE SLIP
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171313000100594 30.000 EA30.10.2026
Material Long Description
:
FLANGE MATERIAL: MILD STEEL
Item Additional
Description:
Sl NoItem CodeQtyUoMExpected Delivery
Date

ISP MATERIAL MANAGEMENT DEPARTMENT
Amendment Date:Amendment No:
Contracting Agency:30.06.2026TE Date:
MJ/C06/2026/3776-FLANGE
SLIP
1400013656
RFQ Title:
TE No:
IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)
      Page 2 / *
271313000100601 30.000 EA30.10.2026
Material Long Description
:
FLANGE MATERIAL: MILD STEEL
Item Additional
Description:`;

    const items = parseIiscoRfqItems(text);

    expect(items).toHaveLength(2);
    expect(items[1]!.itemCode).toBe("71313000100601");
  });

  it("parses a quantity with a thousands-separator comma", () => {
    // Verified against examples/RFx 1400012634.PDF, where "1,200.000" broke
    // the plain "[\d.]+" quantity pattern and silently dropped the item.
    const text = `RFQ Item Details
RFQ Description :
Procurement of NIPPLE MS
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171308000100269       1,200.000 EA30.01.2026
Material Long Description
:
NIPPLE MATERIAL: MILD STEEL
Item Additional
Description:`;

    const items = parseIiscoRfqItems(text);

    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(1200);
  });
});
