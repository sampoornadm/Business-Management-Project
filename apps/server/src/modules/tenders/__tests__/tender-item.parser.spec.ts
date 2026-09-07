import { describe, expect, it } from "vitest";

import { parseIiscoRfqItems } from "../tender-item.parser.js";

// Real `pdftotext -layout` output for the IISCO/SAIL "RFQ Item Details" table
// (TE No 1400014021, item 1 of a real 13-item, 9-page document) — not a
// hand-typed guess. `-layout` keeps each visual row on one physical line
// (slNo/itemCode/qty/unit/date all on the same line), unlike pdftotext's
// default mode, which puts each cell on its own line and — the reason this
// parser switched modes — scrambles that cell order near a page break.
const SINGLE_ITEM_TEXT = ` Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                  Date
   1                       71308000800110                     160.000           EA                                05.12.2026
 Material Long Description WELD NIPPLE MATERIAL : SEAMLEES STAINLESS STEEL MATERIAL SPEC : AISI 304
 :                         SCHEDULE : 80 END CONNECTION 1 : BUTT WELD BEVELED END CONNECTION 2 :
                           3/8 INCH BSPT SIZE : 3/8 INCH LENGTH : 60 MM
 Item Additional
 Description:`;

// Real `pdftotext -layout` output for items 3 and 4 of the same document,
// spanning a real page break (item 4's row is the last one on page 3; the
// page-3-to-4 letterhead/TE-No/RFQ-Title boilerplate lands right after it,
// before item 4's description resumes on page 4). This is the exact shape
// that broke pdftotext's DEFAULT mode (see git history / tender-item.parser.ts's
// top comment) — item 4's own column-header anchor got scrambled by the page
// break there, dropping the item silently. `-layout` keeps item 4's row
// intact; this test locks in that the boilerplate in between still gets
// stripped so item 4's description doesn't end up containing "Page 4 / 9
// IISCO STEEL PLANT BID INVITATION...".
const ITEMS_ACROSS_PAGE_BREAK_TEXT = `Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                 Date
  3                       71311000800062                      30.000           EA                                05.12.2026
Material Long Description SOCKET DESIGN SPECIFICATION            : ASME B16.11 MATERIAL
:                                              : STAINLESS STEEL 316 TYPE,THREAD        :
                          BSP WORKING PRESSURE              : CLASS 2000 SIZE
                                                   : 3/8 INCH    THREADED LENGTH: FULL
Item Additional
Description:




Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                 Date
  4                       71311000800061                     70.000           EA                                 05.12.2026
Material Long Description SOCKET DESIGN SPECIFICATION           : ASME B16.11 MATERIAL
:                                              : STAINLESS STEEL 316 TYPE,THREAD       :
                          BSP WORKING PRESSURE              : CLASS 2000 SIZE




                                                                                                                                    Page 4 / 9
                                                                                                      IISCO STEEL PLANT
                                              BID INVITATION                                          ISP GST : 19AAACS7062F6Z6
                             (Kindly scrutinize the dates carefully for timely response submission)   Corporate Identity No:
                                                                                                      L27109DL1973GOI006454
TE No:        1400014021                  TE Date:    29.08.2026            Contracting Agency:        ISP MATERIAL MANAGEMENT DEPARTMENT
RFQ Title:    MJ/C06/2026/4236-SOCKET     Amendment No:                           Amendment Date:


                                                         : 3/4 INCH      THREADED LENGTH: FULL
Item Additional
Description:`;

describe("parseIiscoRfqItems", () => {
  it("extracts a single item with exact item code, quantity, unit, and description", () => {
    const items = parseIiscoRfqItems(SINGLE_ITEM_TEXT);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      itemCode: "71308000800110",
      description:
        "WELD NIPPLE MATERIAL : SEAMLEES STAINLESS STEEL MATERIAL SPEC : AISI 304 : SCHEDULE : 80 END CONNECTION 1 : BUTT WELD BEVELED END CONNECTION 2 : 3/8 INCH BSPT SIZE : 3/8 INCH LENGTH : 60 MM",
      quantity: 160,
      unit: "EA",
    });
  });

  it("returns an empty array for text with no item table", () => {
    const items = parseIiscoRfqItems("This is a plain Word document with no tender item table at all.");

    expect(items).toEqual([]);
  });

  it("extracts both items across a real page break, with no boilerplate in the description", () => {
    const items = parseIiscoRfqItems(ITEMS_ACROSS_PAGE_BREAK_TEXT);

    expect(items).toHaveLength(2);

    expect(items[0]).toEqual({
      itemCode: "71311000800062",
      description:
        "SOCKET DESIGN SPECIFICATION : ASME B16.11 MATERIAL : : STAINLESS STEEL 316 TYPE,THREAD : BSP WORKING PRESSURE : CLASS 2000 SIZE : 3/8 INCH THREADED LENGTH: FULL",
      quantity: 30,
      unit: "EA",
    });

    // The regression this test guards: item 4's description spans the page
    // break, and must NOT contain any of the reprinted letterhead/header text.
    expect(items[1]).toEqual({
      itemCode: "71311000800061",
      description:
        "SOCKET DESIGN SPECIFICATION : ASME B16.11 MATERIAL : : STAINLESS STEEL 316 TYPE,THREAD : BSP WORKING PRESSURE : CLASS 2000 SIZE : 3/4 INCH THREADED LENGTH: FULL",
      quantity: 70,
      unit: "EA",
    });
    for (const item of items) {
      expect(item.description).not.toMatch(/Page \d+|IISCO STEEL PLANT|BID INVITATION|TE No|RFQ Title/);
    }
  });
});
