// Deterministic fallback for the Terms & Notes section, used when TENDER_NOTES_AI_ENABLED is
// off (or the LLM is unavailable). Best-effort by nature: tender PDFs repeat a full letterhead
// block on every page and wrap lines mid-sentence, so this strips the recurring boilerplate,
// finds Note/NIT/ITT section markers, and puts numbered points on their own lines. The LLM
// path handles this far more robustly — see tender-extraction.service.ts.

// Letterhead / page-chrome / header-table lines that carry no terms content. Best-effort: the
// LLM path handles this properly; this just keeps the deterministic fallback readable.
const NOISE_LINE = new RegExp(
  [
    "^ISP MATERIAL MANAGEMENT",
    "^Amendment (Date|No)",
    "^Contracting Agency",
    "^IISCO STEEL",
    "^ISP GST",
    "^Corporate Identity",
    "^L\\d{5}[A-Z]{2}\\d{4}", // CIN (e.g. L27109DL1973GOI006454)
    "^BID INVITATION",
    "^\\(Kindly scrutinize",
    "^Page\\s+[ivxlcdm\\d]+\\s*/",
    "^RFQ Title\\s*:",
    "^TE No\\s*:",
    "^Tender Header Information",
    "MJ/C\\d", // case-file ref, appears mid-line too
    "^\\d{9,}$",
    // Header-fields table that sits between the undertakings and the numbered notes.
    "^Pur\\s*Grp",
    "^Dealing Officer",
    "^E-?mail",
    "^Mobile No",
    "Bid Submission Deadline",
    "Evaluation Criteria",
    "RA Applicable",
    "Price Bid Option",
    "^Bid Type",
    "Quotation validity in days",
    "Sources for Supply",
    "^\\d{2}\\.\\d{2}\\.\\d{4}\\s+\\d{2}:\\d{2}:\\d{2}", // the 00.00.0000 timestamp row
    "^\\*{3,}",
  ].join("|"),
  "i",
);

// Where the terms/notes region ends and the item/detail tables begin.
const HARD_STOP = /^(RFQ Item Details|RFQ Description|Sl\s*No|Material Long Description|Item Additional|Sources for Supply)/i;

const NUMBERED = /^\d+[.)]\s+/;

interface Marker {
  test: (line: string) => RegExpMatchArray | boolean | null;
  title: (m: RegExpMatchArray | boolean) => string;
}

const MARKERS: Marker[] = [
  // "Note:- Anti-bribery Undertaking:" / "Note: Safety... Undertaking:-"
  { test: (l) => l.match(/^Note\s*:-?\s*(.+?)\s*:-?\s*$/i), title: (m) => (m as RegExpMatchArray)[1]!.trim() },
  // bare "Note:" heading a numbered list
  { test: (l) => /^Note\s*:?-?\s*$/i.test(l), title: () => "Notes" },
  { test: (l) => l.match(/^Instructions?\s+to\s+(Tenderers|Bidders)/i), title: (m) => `Instructions to ${(m as RegExpMatchArray)[1]}` },
  { test: (l) => /^\(?\s*NIT\b/i.test(l), title: () => "NIT" },
];

function matchMarker(line: string): string | null {
  // Skip over-long lines: a real heading is short. Guards against a paragraph that merely
  // starts with the word "Note" being treated as a section header.
  if (line.length > 90) return null;
  for (const marker of MARKERS) {
    const m = marker.test(line);
    if (m) {
      const title = marker.title(m);
      if (title && title.length <= 80) return title;
    }
  }
  return null;
}

export function parseTenderNotes(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const out: string[] = [];
  let inSection = false;

  for (const line of lines) {
    if (!line || NOISE_LINE.test(line)) continue;
    if (HARD_STOP.test(line)) {
      inSection = false;
      continue;
    }

    const title = matchMarker(line);
    if (title) {
      if (out.length) out.push("");
      out.push(`## ${title}`);
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    if (NUMBERED.test(line)) {
      out.push(`- ${line.replace(NUMBERED, "")}`);
    } else if (out.length && out[out.length - 1]!.startsWith("- ")) {
      // A wrapped continuation of the previous point.
      out[out.length - 1] += ` ${line}`;
    } else {
      out.push(line);
    }
  }

  const result = out.join("\n").trim();
  return result || null;
}
