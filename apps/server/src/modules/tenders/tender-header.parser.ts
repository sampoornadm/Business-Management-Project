import type { TenderExtractionFields } from "@bmp/types";

// This template's header/detail tables are drawn such that pdftotext groups
// each table CELL's text into its own line, but orders whole COLUMNS before
// rows: all of a row-group's labels print first, then all of its values,
// with unrelated page furniture (the letterhead box, a neighboring mini
// table sharing the same vertical band) interleaved between the two groups
// — e.g. "TE No:\nRFQ Title:\n\n1400013427\nMJ/C07/2026/3465\n\nTE Date:".
// Verified directly against a real IISCO/SAIL BID INVITATION sample
// (TE No 1400013427, "FKM O Ring") run through the actual `pdftotext` CLI —
// not a hand-typed guess at its output.

const TE_NO_ANCHOR = /TE No\s*:/;

// The issuing company name is the first line of the letterhead box, followed
// by its GST number. It is not necessarily the first line of the whole
// document — pdftotext places the "BID INVITATION" title before it.
const CLIENT_NAME = /([^\n]+)\nISP GST/;

// TE No's and RFQ Title's labels print together, then their values print
// together in the same order — TE No's value line first, then RFQ Title's
// (which may wrap onto more than one line for a long title).
const NUMBER_AND_TITLE_BLOCK = /TE No\s*:\s*\nRFQ Title\s*:\s*\n\n([\s\S]*?)\n\nTE Date\s*:/;

// TE Date's value sits on its own line directly under its label.
const OPENING_DATE = /TE Date\s*:\s*\n(\d{2}\.\d{2}\.\d{4})/;

// Contracting Agency's value is displaced all the way to the end of the
// letterhead box that happens to share its row's vertical band — it's the
// line right after the CIN number.
const DEPARTMENT = /Corporate Identity No\s*:\s*\n[^\n]+\n([^\n]+)\n\n/;

// The submission-deadline value's own format ("06.06.2026 15:00:00 Hrs") is
// distinctive enough to match directly, without needing to anchor on its
// label's position (which floats depending on what else shares the page).
const SUBMISSION_DATE = /(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})\s*Hrs/;

// Quotation validity's value ("60") is a bare number, so unlike the
// submission date it does need a label anchor — the next standalone
// digits-only line after the label, skipping over the letterhead box that
// gets interleaved between them.
const VALIDITY_DAYS = /Quotation validity in days[\s\S]*?\n\n(\d+)\n/;

// Bid Type's value is the first entry of a whole group of values (Bid Type,
// Type, Price Bid Option, ...) that only appears once, right after the
// group's last label ("Sources for Supply / Execution") and the interleaved
// TE Date/Amendment No pair that always follows it in this template.
const BID_TYPE =
  /Sources for Supply\s*\/\s*Execution\s*\n\s*\nTE Date\s*:\s*\n\d{2}\.\d{2}\.\d{4}\s*\nAmendment No\s*:\s*\n\n([^\n]+)\n/;

// Pur Grp/Case File/Dealing Officer/E-mail's labels print together, then
// their values print together, each value its own blank-line-separated
// chunk (a long e-mail may itself wrap onto a second line mid-domain, e.g.
// "Mozumder.Avishek@mjunction.\nin"). The officer's name and e-mail are
// always the last two chunks, regardless of whether the earlier columns
// (Pur Grp, Case File) are populated.
const DEALING_OFFICER_BLOCK = /E-mail\s*\n\n([\s\S]*?)\n\nMobile No/;
const EMAIL_PATTERN = /^[a-z][\w.+-]*@[\w.-]+\.[a-zA-Z]{2,}$/i;

const RFQ_DESCRIPTION = /RFQ Description\s*:?\s*\n?([\s\S]*?)Instructions to Tenderers/;
const ITT_BLOCK = /Instructions to Tenderers\s*\(ITT\)\s*:?\s*\n?([\s\S]*?)Sl\s*No\s*Item\s*Code/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Some documents leave this deadline unset, rendered literally as
// "00.00.0000 00:00:00" rather than omitting the field — treat an all-zero
// date as absent.
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
      fields.tenderNumber = lines[0];
      fields.title = normalizeWhitespace(lines.slice(1).join(" "));
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

  const dealingOfficerBlock = text.match(DEALING_OFFICER_BLOCK);
  if (dealingOfficerBlock) {
    const chunks = dealingOfficerBlock[1]!
      .split(/\n\s*\n/)
      .map((chunk) => chunk.replace(/\n/g, "").trim())
      .filter(Boolean);
    const email = chunks[chunks.length - 1];
    const name = chunks[chunks.length - 2];
    if (email && EMAIL_PATTERN.test(email)) fields.dealingOfficerEmail = email;
    if (name) fields.dealingOfficerName = name;
  }

  const description = text.match(RFQ_DESCRIPTION);
  if (description) fields.description = normalizeWhitespace(description[1]!.replace(/#/g, " "));

  const itt = text.match(ITT_BLOCK);
  if (itt) fields.remarks = normalizeWhitespace(itt[1]!.replace(/#/g, " "));

  return fields;
}
