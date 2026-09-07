import type { ExtractedTenderItem } from "@bmp/types";

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

// pdftotext -layout reprints this exact letterhead + TE-No/RFQ-Title header
// block at every page break, sandwiched between "Page N / M" and whatever
// content resumes — 7 lines total (the Page-number line, then 6 more).
// Column spacing drifts by a few characters page to page even though the
// words are byte-identical (confirmed: diff after collapsing space runs is
// empty) — likely `-layout` repositioning text based on what else shares
// each page — so removal has to be whitespace-tolerant, not a literal
// string match.
const PAGE_BREAK_BLOCK = /Page \d+ \/ \d+\n(?:.*\n){6}/g;

// Placeholder for the page number while checking whether the block recurs
// unchanged: contains no regex metacharacters, so it survives the
// metachar-escaping step in toWhitespaceTolerantPattern() untouched, and is
// then swapped for a real `\d+` wildcard afterward.
const PAGENUM_TOKEN = "XPAGENUMX";

function normalizeBlockWhitespace(block: string): string {
  return block
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

function toWhitespaceTolerantPattern(block: string): RegExp {
  const escaped = block
    .trim()
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex metachars
        .replace(/ +/g, "\\s+"), // any run of literal spaces -> flexible \s+
    )
    .join("\\s*\\n\\s*")
    .replace(new RegExp(PAGENUM_TOKEN, "g"), "\\d+"); // restore the digit wildcard post-escaping
  return new RegExp(`\\s*${escaped}\\s*\\n?`, "g");
}

// Strips every occurrence of the repeating page-break letterhead block from
// the text, so it can never end up glued onto a description that spans a
// page break. Two passes: (1) detect the block and confirm every occurrence
// normalizes to the same shape — if a document's letterhead isn't uniform
// across pages (a different template, say), this bails out and returns the
// text unstripped rather than guessing; (2) build one whitespace-tolerant,
// page-number-agnostic pattern from that shape and remove every real
// occurrence (each with its own literal page number).
function stripPageBoilerplate(text: string): string {
  const candidates = [...text.matchAll(PAGE_BREAK_BLOCK)].map((m) => m[0]);
  if (candidates.length === 0) return text;

  const shapes = new Set<string>();
  for (const raw of candidates) {
    shapes.add(normalizeBlockWhitespace(raw).replace(/Page \d+ \/ \d+/, `Page ${PAGENUM_TOKEN} / ${PAGENUM_TOKEN}`));
  }
  if (shapes.size !== 1) return text;

  const pattern = toWhitespaceTolerantPattern([...shapes][0]!);
  return text.replace(pattern, "\n");
}

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
