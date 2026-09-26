import type { TenderDocumentType } from "@bmp/types";

/**
 * Deterministic half of the required-documents checklist: a closed-vocabulary dictionary,
 * matched the same way assistant.parser.ts matches document kind/status — an LLM is never asked
 * to judge what a tender "requires", only this fixed phrase table is. Scoped to the document
 * types this system actually has an upload slot for (TENDER_DOCUMENT_TYPES); generic bidder-
 * compliance terms with no matching slot here (EMD, GST certificate, PAN, solvency certificate,
 * ...) are deliberately not included — flagging them as "missing" would have nowhere for the
 * user to act on it in the Documents tab.
 *
 * Extend this table when a real tender's notes mention a requirement it misses — that is a
 * smaller, safer loop than replacing it with a model.
 */
const DOCUMENT_TYPE_PHRASES: Array<[TenderDocumentType, RegExp]> = [
  ["CORRIGENDUM", /\bcorrigendum\b/i],
  ["ADDENDUM", /\baddendum\b/i],
  ["DRAWINGS", /\bdrawings?\b/i],
  ["TECHNICAL_SPECS", /\btechnical\s+specifications?\b/i],
  ["BOQ", /\bbill\s+of\s+quantit(?:y|ies)\b|\bBOQ\b/i],
  ["UNDERTAKING", /\bundertakings?\b/i],
  ["TENDER_NOTICE", /\btender\s+notice\b/i],
  ["NIT", /\bNIT\b|\bnotice\s+inviting\s+tender\b/i],
];

export interface DetectedDocumentRequirement {
  type: TenderDocumentType;
  matchedPhrase: string;
}

// Every notes-generation path in this app (tender-extraction.service.ts, tender-notes.parser.ts)
// renders its own section titles as "## <heading>" lines — including a literal "## Notice
// Inviting Tender (NIT)" heading on every tender parsed from the SAIL/IISCO template. That
// heading is a structural artifact of OUR OWN parser, not a requirement the source document
// stated, so headings are stripped before matching — only body text counts as a mention.
const MARKDOWN_HEADING = /^#{1,6}\s.*$/gm;

export function detectRequiredDocuments(notes: string): DetectedDocumentRequirement[] {
  const body = notes.replace(MARKDOWN_HEADING, "");
  const results: DetectedDocumentRequirement[] = [];
  for (const [type, pattern] of DOCUMENT_TYPE_PHRASES) {
    const match = body.match(pattern);
    if (match) results.push({ type, matchedPhrase: match[0] });
  }
  return results;
}
