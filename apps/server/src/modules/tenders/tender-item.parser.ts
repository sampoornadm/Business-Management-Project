import type { ExtractedTenderItem } from "@bmp/types";

// This header line repeats verbatim before every item row in IISCO/SAIL's
// "RFQ Item Details" table — it's the anchor that splits the text into one
// chunk per item, regardless of how many items the document has. Scoped to
// just "Sl No/Item Code/Qty/UoM" (not the full column list) since
// pdftotext pushes "Expected Delivery Date" to the end of each item's block
// rather than keeping it adjacent to the other column headers.
const ITEM_ANCHOR = /Sl\s*No\s*\n\s*\nItem\s*Code\s*\n\s*\nQty\s*\n\s*\nUoM/gi;

// pdftotext gives each cell its own line (unlike pdf-parse, which glued
// slNo+itemCode with no separator) — a row is 4 consecutive whole lines:
// slNo (1-3 digits), the item code (consistently 14 digits in every sample
// document), qty (may carry a thousands-separator comma, e.g. "1,500.000"),
// then UoM. Anchoring each capture to a whole line (^...$/m) means
// unrelated digit runs elsewhere in the chunk (GST/CIN numbers, page
// markers) can't be mistaken for a row.
const ITEM_ROW = /^(\d{1,3})\n(\d{14})\n([\d,]+\.\d+)\n([A-Za-z]+)$/m;

// The label and the value's first line print on the same source line
// ("Material Long Description O-RING MATERIAL : FKM ..."); the label's own
// wrapped ":" then lands alone on the next line. Both are stripped below.
const DESCRIPTION_BLOCK = /Material Long Description([\s\S]*?)Item Additional/;

// Scoped to the IISCO/SAIL RFQ item-table layout only — other clients' bid
// formats are a separate, later addition, not attempted here. If the anchor
// never appears (a non-IISCO document, or one with no item table), this
// returns an empty array and the caller still gets header-field extraction.
//
// Verified against a real single-item sample run through the actual
// `pdftotext` CLI. Multi-item documents are assumed (not directly verified)
// to repeat this same per-item anchor+row shape, mirroring how pdf-parse's
// equivalent anchor was documented to repeat per row in 13- and 18-item
// samples — flag it if a multi-item document extracts wrong.
export function parseIiscoRfqItems(text: string): ExtractedTenderItem[] {
  const chunks = text.split(ITEM_ANCHOR);

  const items: ExtractedTenderItem[] = [];
  for (const chunk of chunks.slice(1)) {
    const rowMatch = chunk.match(ITEM_ROW);
    if (!rowMatch) continue;

    const [, , itemCode, quantity, unit] = rowMatch;
    const descriptionMatch = chunk.match(DESCRIPTION_BLOCK);
    const description = descriptionMatch
      ? descriptionMatch[1]!
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && line !== ":")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      : "";

    items.push({
      itemCode: itemCode!,
      description,
      quantity: Number(quantity!.replace(/,/g, "")),
      unit,
    });
  }

  return items;
}
