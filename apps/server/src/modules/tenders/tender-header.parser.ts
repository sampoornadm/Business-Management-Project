import type { TenderExtractionFields } from "@bmp/types";

// This template's header/detail tables are drawn such that pdf-parse extracts
// the VALUE immediately before its LABEL, with no separator — e.g. the raw
// text literally reads "Contracting Agency:30.06.2026TE Date:" and
// "07.07.2026 15:00:00 HrsBid Submission Deadline". Verified directly against
// examples/BID1400013656.PDF and examples/RFx 1400012649.PDF (same template).
// Feeding this scrambled text straight to the LLM produced wrong values
// (it picked the RFQ Title's value for tenderNumber) — tenderNumber is the
// DB's @unique key, so it gets the same zero-tolerance treatment item codes
// already get in tender-item.parser.ts: deterministic regex, not the model.

const TE_NO_ANCHOR = /TE No\s*:/;

// The issuing company name is always the very first line of the document,
// followed by its GST number — distinct from "department" (a sub-unit
// within it, e.g. "ISP MATERIAL MANAGEMENT DEPARTMENT").
const CLIENT_NAME = /^([^\n]+)\nISP GST/;

// The RFQ Title and TE No values both appear, in that order, in a block
// BEFORE their own labels (which then appear in the same order): the block
// between "TE Date:" and "TE No:" is "<RFQ Title, 1-2 lines>\n<TE No>\n
// RFQ Title:\n" — so within that block, the LAST line is TE No's value and
// everything before it is RFQ Title's value.
const NUMBER_AND_TITLE_BLOCK = /TE Date\s*:\s*\n([\s\S]*?)RFQ Title\s*:\s*\n?TE No\s*:/;

// TE Date's value sits directly before its own label, no separator.
const OPENING_DATE = /(\d{2}\.\d{2}\.\d{4})TE Date\s*:/;

// Department/contracting agency is the plain line right after the standard
// "(Kindly scrutinize...)" instruction line, before the scrambled table run
// starts — not extracted from the scrambled block itself.
const DEPARTMENT = /\(Kindly scrutinize the dates carefully for timely response submission\)\s*\n([^\n]+)\n/;

const SUBMISSION_DATE = /(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})\s*Hrs\s*Bid Submission Deadline/;
const VALIDITY_DAYS = /(\d+)Quotation validity in days/;
const BID_TYPE = /Quotation validity in days([\s\S]*?)Bid Type/;

// Dealing Officer name + e-mail are concatenated with no separator at all
// ("Paramita Sinhaparamita.sinha@mjunction.in") — a plain regex split
// backtracks to whatever the *shortest* valid email match is (e.g. splits
// after "Sinhaparamit" / before "a.sinha@..."), not the real word boundary,
// since nothing in the raw characters marks where the name ends. Instead,
// this exploits the "email local-part mirrors the name, lowercased" naming
// convention visible in every sample document: try each possible split
// point and accept the one where the local-part (dots removed, lowercased)
// exactly equals the name candidate (spaces removed, lowercased).
const DEALING_OFFICER_ROW = /Mobile No\s*\n([\s\S]*?)Tender Header Information/;
const EMAIL_ANCHOR = /[a-z][\w.+-]*@[\w.-]+\.[a-zA-Z]{2,}/;

function splitDealingOfficerLine(line: string): { name?: string; email?: string } {
  const emailMatch = line.match(EMAIL_ANCHOR);
  if (!emailMatch) return {};
  const atIndex = line.indexOf("@", emailMatch.index);
  const domain = line.slice(atIndex);
  const beforeAt = line.slice(0, atIndex);

  // Name candidates must start right after a real space (a genuine word
  // boundary) — not just at position 0 — since the Pur Grp/Case File values
  // earlier in the same row are equally unseparated from what precedes them
  // (e.g. "METAL PIPESMJ/C06/...-FLANGE SLIP Paramita Sinha..."); anchoring
  // only at position 0 would require that whole prefix to also satisfy the
  // equality check below, which it never does.
  const starts = [0, ...[...beforeAt].map((ch, i) => (ch === " " ? i + 1 : -1)).filter((i) => i >= 0)];

  for (const start of starts) {
    for (let i = start + 1; i < beforeAt.length; i++) {
      const namePart = beforeAt.slice(start, i).trim();
      const localPart = beforeAt.slice(i);
      if (!namePart || !localPart || !/^[A-Z]/.test(namePart)) continue;
      const nameKey = namePart.toLowerCase().replace(/\s+/g, "");
      const localKey = localPart.toLowerCase().replace(/[.+-]/g, "");
      if (nameKey === localKey) {
        return { name: namePart, email: `${localPart}${domain}` };
      }
    }
  }
  return {};
}

const RFQ_DESCRIPTION = /RFQ Description\s*:?\s*\n?([\s\S]*?)Instructions to Tenderers/;
const ITT_BLOCK = /Instructions to Tenderers\s*\(ITT\)\s*:?\s*\n?([\s\S]*?)Sl\s*No\s*Item\s*Code/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Some documents leave this deadline unset, rendered literally as
// "00.00.0000 00:00:00" (verified against examples/RFx 1400012609.PDF and
// others) rather than omitting the field — treat an all-zero date as absent.
function ddmmyyyyToIso(value: string): string | undefined {
  const [day, month, year] = value.split(".");
  if (day === "00" || month === "00" || year === "0000") return undefined;
  return `${year}-${month}-${day}`;
}

function ddmmyyyyHmsToIso(value: string): string | undefined {
  const [datePart, timePart] = value.split(/\s+/);
  const isoDate = ddmmyyyyToIso(datePart!);
  return isoDate ? `${isoDate}T${timePart}` : undefined;
}

export interface ParsedIiscoHeaderFields extends TenderExtractionFields {
  clientName?: string;
}

// Scoped to the IISCO/SAIL "BID INVITATION" template only, mirroring
// parseIiscoRfqItems' scoping — returns null if the core anchor isn't found
// so the caller knows to fall back to the LLM for an unrecognized document.
export function parseIiscoHeaderFields(text: string): ParsedIiscoHeaderFields | null {
  if (!TE_NO_ANCHOR.test(text)) return null;

  const fields: ParsedIiscoHeaderFields = {};

  const clientName = text.match(CLIENT_NAME);
  if (clientName) fields.clientName = clientName[1]!.trim();

  const numberAndTitle = text.match(NUMBER_AND_TITLE_BLOCK);
  if (numberAndTitle) {
    const lines = numberAndTitle[1]!.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length > 0) {
      fields.tenderNumber = lines[lines.length - 1];
      fields.title = normalizeWhitespace(lines.slice(0, -1).join(" "));
    }
  }

  const openingDate = text.match(OPENING_DATE);
  const openingDateIso = openingDate ? ddmmyyyyToIso(openingDate[1]!) : undefined;
  if (openingDateIso) fields.openingDate = openingDateIso;

  const department = text.match(DEPARTMENT);
  if (department) fields.department = normalizeWhitespace(department[1]!);

  const submissionDate = text.match(SUBMISSION_DATE);
  const submissionDateIso = submissionDate ? ddmmyyyyHmsToIso(submissionDate[1]!) : undefined;
  if (submissionDateIso) fields.submissionDate = submissionDateIso;

  const validityDays = text.match(VALIDITY_DAYS);
  if (validityDays) fields.validityPeriodDays = Number(validityDays[1]);

  const bidType = text.match(BID_TYPE);
  if (bidType) fields.type = normalizeWhitespace(bidType[1]!);

  const dealingOfficerRow = text.match(DEALING_OFFICER_ROW);
  if (dealingOfficerRow) {
    // Join on empty string (not a space) — this reassembles column-width
    // word-wraps that split mid-token (e.g. "...@mjunction.\nin", verified
    // against examples/RFx 1400012649.PDF) while still preserving genuine
    // spaces that already existed at a line's own start/end (e.g. the
    // leading space before the officer's name itself).
    const joinedRow = dealingOfficerRow[1]!.split("\n").join("").trim();
    const { name, email } = splitDealingOfficerLine(joinedRow);
    if (name) fields.dealingOfficerName = name;
    if (email) fields.dealingOfficerEmail = email;
  }

  const description = text.match(RFQ_DESCRIPTION);
  if (description) fields.description = normalizeWhitespace(description[1]!.replace(/#/g, " "));

  const itt = text.match(ITT_BLOCK);
  if (itt) fields.remarks = normalizeWhitespace(itt[1]!.replace(/#/g, " "));

  return fields;
}
