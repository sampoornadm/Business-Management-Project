import type { ExtractedTenderItem } from "@bmp/types";

// pdf-parse's raw text repeats this exact block on every page (header/footer
// boilerplate). When an item row lands on a page boundary, this text gets
// interleaved between the item-table anchor and the item's data line —
// stripping it first is required or those rows fail to parse (verified
// against examples/RFx 1400012649.PDF, a 13-item document with two items
// straddling a page break).
// The page-count token isn't always a digit: the footer reads "Page 2 / *"
// (total not yet known) until the total becomes fixed later in the document,
// e.g. "Page 10 / 13" (verified against examples/BID1400013656.PDF, an
// 18-item document where the "\d+" — digits-only — version of this pattern
// silently failed to strip the boilerplate on 9 of 13 pages, dropping 12 of
// 18 items). "\S+" matches "*", roman numerals, and digits alike.
const PAGE_BOILERPLATE = /ISP MATERIAL MANAGEMENT DEPARTMENT[\s\S]*?Page\s+\S+\s*\/\s*\S+\n?/g;

// This header line repeats verbatim before every item row in IISCO/SAIL's
// "RFQ Item Details" table — it's the anchor that splits the text into one
// chunk per item, regardless of how many items the document has.
const ITEM_ANCHOR = /Sl\s*No\s*Item\s*Code\s*Qty\s*UoM\s*Expected\s*Delivery\s*\n?\s*Date/gi;

// slNo (1-3 digits) and the item code run together with no separator in the
// raw text (e.g. "171301005600045" = slNo "1" + itemCode "71301005600045").
// The item code is consistently 14 digits in every sample document, so a
// non-greedy slNo capture followed by an exact 14-digit run reliably
// separates the two via backtracking.
// Qty can carry a thousands-separator comma (e.g. "1,200.000" — verified
// against examples/RFx 1400012634.PDF, where the plain "[\d.]+" version of
// this pattern failed to match the row at all, silently dropping the
// document's only item).
const ITEM_ROW = /^\s*(\d{1,3}?)(\d{14})\s+([\d,.]+)\s+([A-Za-z]+)(\d{2}\.\d{2}\.\d{4})/;

const DESCRIPTION_BLOCK = /Material Long Description\s*:?\s*\n?([\s\S]*?)Item Additional/;

// Scoped to the IISCO/SAIL RFQ item-table layout only — other clients' bid
// formats are a separate, later addition, not attempted here. If the anchor
// never appears (a non-IISCO document, or one with no item table), this
// returns an empty array and the caller still gets header-field extraction.
export function parseIiscoRfqItems(text: string): ExtractedTenderItem[] {
  const cleaned = text.replace(PAGE_BOILERPLATE, "");
  const chunks = cleaned.split(ITEM_ANCHOR);

  const items: ExtractedTenderItem[] = [];
  for (const chunk of chunks.slice(1)) {
    const rowMatch = chunk.match(ITEM_ROW);
    if (!rowMatch) continue;

    const [, , itemCode, quantity, unit] = rowMatch;
    const descriptionMatch = chunk.match(DESCRIPTION_BLOCK);
    const description = descriptionMatch ? descriptionMatch[1]!.replace(/\s+/g, " ").trim() : "";

    items.push({
      itemCode: itemCode!,
      description,
      quantity: Number(quantity!.replace(/,/g, "")),
      unit,
    });
  }

  return items;
}
