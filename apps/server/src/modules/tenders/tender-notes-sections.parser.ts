import { stripPageBoilerplate } from "./tender-pdf-boilerplate.js";

// Scoped to the IISCO/SAIL "BID INVITATION" template only, same null-
// fallback convention as parseIiscoHeaderFields/parseIiscoRfqItems — the
// caller falls back to a whole-document AI call for any other template.
//
// Requires text extracted via `pdftotext -layout`, same as
// tender-item.parser.ts and for the same reason: section headings and their
// body text stay on intact physical lines across a page break under
// `-layout`, and stripPageBoilerplate (shared with that parser) already
// knows how to remove the reprinted per-page letterhead from this mode.
//
// Verified directly against the real `pdftotext -layout` output of a real
// IISCO/SAIL BID INVITATION document (TE No 1400014147, "SELF ADHESSIVE PVC
// INSULATING TAPE"). In that document's cover section, the sections appear
// in this order: RFQ Description, Notice Inviting Tender (NIT), a "Note:
// SAIL ISP shall issue the Goods Receipt and Acceptance Note (GRN)..."
// billing note, Instructions to Tenderers (ITT), then the item table.
//
// The GRN note is reprinted VERBATIM twice — once glued onto NIT's own
// tail, once again glued onto ITT's tail (the mid-page-break split in the
// real document even lands inside the note's own sentence: "...under the
// Bidder's" / [page break] / "Manual tab." — which is exactly why
// stripPageBoilerplate has to run first, not as a nice-to-have). Extracting
// it as its own section AND stopping NIT/ITT before their trailing copy
// both key off the same anchor — see captureSection below: searching for
// the nearest GRN_NOTE_START *after* a section's own start naturally lands
// on that section's own trailing copy (first copy for NIT, second for ITT),
// with no manual "which occurrence" bookkeeping needed.

export type NoteSectionKey = "rfqDescription" | "nit" | "itt" | "grnNote";

export interface ExtractedSection {
  key: NoteSectionKey;
  heading: string;
  text: string;
}

const RFQ_DESC_HEADING = /RFQ Description\s*:/;
const NIT_HEADING = /Notice Inviting Tender\s*\(NIT\)\s*:/;
const ITT_HEADING = /Instructions to Tenderers\s*\(ITT\)\s*:/;

// Hard stop before the item table — same row-table shape tender-item.parser.ts's
// fixtures use ("Sl No ... Item Code ... Qty ... UoM ...").
const ITEM_TABLE_HEADING = /Sl\s*No\s+Item\s*Code\s+Qty\s+UoM/;

// The billing/GRN note's opening sentence — distinctive and, per the doc
// comment above, reprinted verbatim wherever it appears in this template.
const GRN_NOTE_START =
  /Note\s*:\s*SAIL ISP shall issue the Goods Receipt and\s+Acceptance Note\s*\(GRN\)/i;

// Slices `text` from `start`'s match to whichever `endCandidates` regex
// matches soonest after that point (or end of text if none match).
// `includeStart` keeps the start match itself in the body — needed only for
// GRN_NOTE_START, whose matched phrase IS the note's own opening sentence,
// unlike the other anchors, which are separate heading labels.
function captureSection(
  text: string,
  start: RegExp,
  endCandidates: RegExp[],
  opts: { includeStart?: boolean } = {},
): string | null {
  const startMatch = text.match(start);
  if (!startMatch || startMatch.index === undefined) return null;
  const bodyStart = opts.includeStart ? startMatch.index : startMatch.index + startMatch[0].length;

  let bodyEnd = text.length;
  for (const end of endCandidates) {
    const endMatch = text.slice(bodyStart).match(end);
    if (endMatch?.index !== undefined) bodyEnd = Math.min(bodyEnd, bodyStart + endMatch.index);
  }

  const body = text.slice(bodyStart, bodyEnd).trim();
  return body || null;
}

export function parseIiscoNoteSections(text: string): ExtractedSection[] | null {
  if (!NIT_HEADING.test(text) && !ITT_HEADING.test(text)) return null;

  const cleaned = stripPageBoilerplate(text);
  const sections: ExtractedSection[] = [];

  const rfqDescription = captureSection(cleaned, RFQ_DESC_HEADING, [
    NIT_HEADING,
    ITT_HEADING,
    ITEM_TABLE_HEADING,
  ]);
  if (rfqDescription) sections.push({ key: "rfqDescription", heading: "RFQ Description", text: rfqDescription });

  const nit = captureSection(cleaned, NIT_HEADING, [GRN_NOTE_START, ITT_HEADING, ITEM_TABLE_HEADING]);
  if (nit) sections.push({ key: "nit", heading: "Notice Inviting Tender (NIT)", text: nit });

  const itt = captureSection(cleaned, ITT_HEADING, [GRN_NOTE_START, ITEM_TABLE_HEADING]);
  if (itt) sections.push({ key: "itt", heading: "Instructions to Tenderers (ITT)", text: itt });

  const grnNote = captureSection(cleaned, GRN_NOTE_START, [ITT_HEADING, ITEM_TABLE_HEADING], {
    includeStart: true,
  });
  if (grnNote) sections.push({ key: "grnNote", heading: "Note", text: grnNote });

  return sections.length > 0 ? sections : null;
}
