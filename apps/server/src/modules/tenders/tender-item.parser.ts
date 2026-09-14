import type { ExtractedTenderItem } from "@bmp/types";

import { stripPageBoilerplate } from "./tender-pdf-boilerplate.js";

// Requires text extracted via `pdftotext -layout` (see
// tender-extraction.service.ts, which requests it specifically for this
// parser). pdftotext's DEFAULT mode splits every table cell onto its own
// line and orders whole columns before rows — verified to work for a
// single-item document, but on a real 9-page/13-item document it silently
// dropped 8 of 13 items: a row sitting near a page break gets its cells
// reordered or interleaved with the next page's reprinted letterhead,
// corrupting the column-header anchor this parser used to rely on. Under
// `-layout`, every row instead prints as ONE physical line
// ("1   71308000800110   160.000   EA   05.12.2026"), which survives page
// breaks intact — confirmed against the same real document (all 13 items).

// One item row is one physical line under `-layout`: slNo, then the 14-digit
// item code (consistently 14 digits across every SAIL sample seen), then a
// decimal quantity (may carry a thousands-separator comma), then unit
// letters. Anchored to a whole line (^...$/m via `^` + `\s+` between groups,
// no `$` needed since the trailing "Expected Delivery Date" text is ignored)
// so unrelated digit runs elsewhere (GST/CIN numbers, page markers) can't be
// mistaken for a row.
const ROW = /^\s*(\d{1,3})\s+(\d{14})\s+([\d,]+\.\d+)\s+([A-Za-z]+)/gm;

// The label and the value's first line print on the same source line
// ("Material Long Description O-RING MATERIAL : FKM ..."); the label's own
// wrapped ":" then lands alone on the next line. Both are stripped below.
const DESCRIPTION_BLOCK = /Material Long Description([\s\S]*?)Item Additional/;

// Scoped to the IISCO/SAIL RFQ item-table layout only — other clients' bid
// formats are a separate, later addition, not attempted here. If no row
// matches, this returns an empty array and the caller still gets
// header-field extraction (which runs against separately-extracted,
// default-mode text — see tender-extraction.service.ts).
//
// Verified against the real `pdftotext -layout` output of a real 9-page,
// 13-item IISCO/SAIL document: all 13 items, including every one whose row
// or description spans a page break.
export function parseIiscoRfqItems(text: string): ExtractedTenderItem[] {
  const cleaned = stripPageBoilerplate(text);

  const items: ExtractedTenderItem[] = [];
  const rows = [...cleaned.matchAll(ROW)];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const chunkStart = row.index! + row[0].length;
    const chunkEnd = i + 1 < rows.length ? rows[i + 1]!.index! : cleaned.length;
    const chunk = cleaned.slice(chunkStart, chunkEnd);

    const [, , itemCode, quantity, unit] = row;
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
      unit: unit!,
    });
  }

  return items;
}
