import { describe, expect, it } from "vitest";

import { parseIiscoRfqItems } from "../tender-item.parser.js";

// The real raw-text output of the actual `pdftotext` CLI for a real
// IISCO/SAIL RFQ Item Details table (TE No 1400013427, "FKM O Ring", 1
// item, qty "1,500.000" exercising the thousands-separator case) — not a
// hand-typed guess. See tender-header.parser.spec.ts for why this matters:
// a fixture that only mimics the extractor's assumed output doesn't catch a
// real extractor swap changing that output's actual shape.
const SINGLE_ITEM_TEXT = `RFQ Item Details
RFQ Description :
AUTO COUPLER O RING 42 MM
Instructions to Tenderers (ITT) :
Material Test Certificate (MTC) from Indian Rubber Materials Research Institute OR any NABL accredited OR Govt. authorized Lab to
accompany the supply.

Sl No

Item Code

Qty

UoM

1
71804001603937
1,500.000
EA
Material Long Description O-RING MATERIAL : FKM , SHORE HARDNESS : 80 AS PER ASTM D2240 DIAMETER,
:
INNER : 42 MM SIZE: OD 58 MM, CORD DIAMETER: 8 MM, FOR AUTO COUPLING
SYSTEM OF STEEL TEEMING LADLE OF BOF CONVERTER
Item Additional
Description:

Expected Delivery
Date
28.07.2026

***************This is an electronically generated RFX requires no signature***************`;

// Synthetic — NOT verified against a real multi-item pdftotext dump (every
// real sample available while fixing this had exactly one item). Documents
// the assumption carried over from the pdf-parse-era parser: the "Sl
// No/Item Code/Qty/UoM" anchor repeats once per item, so each item's own
// data quad can be recovered independently regardless of what else
// (descriptions, page furniture) sits between rows. Flag this test if a
// real multi-item document extracts wrong — it means the assumption
// doesn't hold and this fixture needs replacing with real captured output.
const TWO_ITEM_TEXT = `RFQ Item Details
RFQ Description :
ASSORTED FASTENERS

Sl No

Item Code

Qty

UoM

1
71804001603937
1,500.000
EA
Material Long Description first item
Item Additional
Description:

Sl No

Item Code

Qty

UoM

2
71804001603944
250.000
NOS
Material Long Description second item
Item Additional
Description:`;

describe("parseIiscoRfqItems", () => {
  it("extracts a single item with exact item code, quantity, unit, and description", () => {
    const items = parseIiscoRfqItems(SINGLE_ITEM_TEXT);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      itemCode: "71804001603937",
      description:
        "O-RING MATERIAL : FKM , SHORE HARDNESS : 80 AS PER ASTM D2240 DIAMETER, INNER : 42 MM SIZE: OD 58 MM, CORD DIAMETER: 8 MM, FOR AUTO COUPLING SYSTEM OF STEEL TEEMING LADLE OF BOF CONVERTER",
      quantity: 1500,
      unit: "EA",
    });
  });

  it("returns an empty array for text with no item table", () => {
    const items = parseIiscoRfqItems("This is a plain Word document with no tender item table at all.");

    expect(items).toEqual([]);
  });

  it("extracts each item independently when the anchor repeats per row (synthetic)", () => {
    const items = parseIiscoRfqItems(TWO_ITEM_TEXT);

    expect(items).toHaveLength(2);
    expect(items[0]!.itemCode).toBe("71804001603937");
    expect(items[0]!.quantity).toBe(1500);
    expect(items[1]!.itemCode).toBe("71804001603944");
    expect(items[1]!.quantity).toBe(250);
    expect(items[1]!.unit).toBe("NOS");
  });
});
