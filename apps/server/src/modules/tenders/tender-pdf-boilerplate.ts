// Shared by every parser that reads `pdftotext -layout` output for the
// IISCO/SAIL "BID INVITATION" template (tender-item.parser.ts,
// tender-notes-sections.parser.ts) — pdftotext -layout reprints the exact
// letterhead + TE-No/RFQ-Title header block at every page break, sandwiched
// between "Page N / M" and whatever content resumes — 7 lines total (the
// Page-number line, then 6 more). Column spacing drifts by a few characters
// page to page even though the words are byte-identical (confirmed: diff
// after collapsing space runs is empty) — likely `-layout` repositioning
// text based on what else shares each page — so removal has to be
// whitespace-tolerant, not a literal string match.
//
// The total-page count ("M" in "Page N / M") isn't always a resolved digit:
// a real SAIL/IISCO document (TE No 1400014147) printed "Page 2 / *" through
// "Page 9 / *" — a literal "*" placeholder — and only switched to the real
// total ("Page 10 / 11") on its last two pages. A digit-only `\d+` there
// silently failed to match 9 of 11 page breaks, leaving their letterhead
// blocks unstripped and glued onto whichever item description spanned that
// page boundary (item 3's description in that document). Accept `*` too.
//
// The fixed 6-line count after the Page-number line was itself measured
// against a document with a short RFQ Title that fit on one line. This
// document's title is long enough to wrap onto a 7th line under "RFQ
// Title:" (present at every page break, digit-total pages included) — a
// fixed count left that wrap line behind every time, which is what actually
// leaked into item 3's description once the `*` fix above let stripping run
// at all. Trailing `(?:[ \t]*\S.*\n)*` consumes any further non-blank
// lines (the wrap, when present) up to the blank line that always follows.
const PAGE_BREAK_BLOCK = /Page \d+ \/ (?:\d+|\*)\n(?:.*\n){6}(?:[ \t]*\S.*\n)*/g;

// Placeholders for the page-number and total-page-count slots while checking
// whether the block recurs unchanged: contain no regex metacharacters, so
// they survive the metachar-escaping step in toWhitespaceTolerantPattern()
// untouched, and are then swapped for real wildcards afterward. Two distinct
// tokens because the two slots differ: the page number is always a resolved
// digit, but the total ("M" in "Page N / M") can print as an unresolved `*`
// (see PAGE_BREAK_BLOCK) — so only the total slot's wildcard needs to accept
// it too.
const PAGENUM_TOKEN = "XPAGENUMX";
const TOTALPAGES_TOKEN = "XTOTALPAGESX";

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
    .replace(new RegExp(PAGENUM_TOKEN, "g"), "\\d+") // restore the digit wildcard post-escaping
    .replace(new RegExp(TOTALPAGES_TOKEN, "g"), "(?:\\d+|\\*)"); // total may be an unresolved "*"
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
export function stripPageBoilerplate(text: string): string {
  const candidates = [...text.matchAll(PAGE_BREAK_BLOCK)].map((m) => m[0]);
  if (candidates.length === 0) return text;

  const shapes = new Set<string>();
  for (const raw of candidates) {
    shapes.add(
      normalizeBlockWhitespace(raw).replace(
        /Page \d+ \/ (?:\d+|\*)/,
        `Page ${PAGENUM_TOKEN} / ${TOTALPAGES_TOKEN}`,
      ),
    );
  }
  if (shapes.size !== 1) return text;

  const pattern = toWhitespaceTolerantPattern([...shapes][0]!);
  return text.replace(pattern, "\n");
}
