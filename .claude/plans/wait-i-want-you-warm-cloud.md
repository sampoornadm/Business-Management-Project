# Redesign: section-split, parallel-AI Terms & Notes extraction (IISCO/SAIL template)

## Context

Today, `TenderExtractionService.extractFromDocument` pulls the "Terms & Notes" text
(NIT/ITT/Note sections) with **one** whole-document AI call: `NOTES_PROMPT` asks the model to
find every relevant section itself across the full text and copy it verbatim. On a real document
(TE No 1400014147) that call produced a paraphrased summary instead of verbatim content, even
though the actual ITT section (warranty/delivery terms) was well within the prompt's char budget —
diagnosed as the model (`llama3.1:8b`, a small general chat model) not reliably following the
"find sections yourself AND format them exactly" instruction in one shot; it's non-deterministic
per run, not a data-availability bug.

For the recognized IISCO/SAIL "BID INVITATION" template, this repo already deterministically
regex-parses header fields (`tender-header.parser.ts`) and BOQ items (`tender-item.parser.ts`) —
AI is only used for the parts that aren't mechanically extractable. This change brings Terms &
Notes for that same template in line: **regex finds and slices the sections** (deterministic,
zero AI), **AI only cleans/formats each already-bounded section** (a much narrower, easier task
per call), run **in parallel** since the sections are independent, then reassembled in fixed
document order. Non-IISCO documents keep today's single whole-document call unchanged — this is
additive, not a ripout.

Confirmed with the user during planning:
- The "Note" section of interest is specifically the recurring `"Note: SAIL ISP shall issue the
  Goods Receipt and Acceptance Note (GRN)..."` billing note — **not** the Anti-bribery/Safety-
  Environment Undertaking notes, which stay excluded exactly as today (they sit on page 1, before
  `RFQ Description :`, so anchoring extraction from there onward excludes them for free).
- Scope is IISCO/SAIL only for now, but structured so a second template later is one new parser
  file + one more direct call — not a registry/plugin system built ahead of need.
- The earlier "wire `fields.remarks` into the New Tender form" quick-fix idea is dropped — this
  redesign's ITT section (feeding into `notes`, which the form already reads) covers that need.

## Implementation

**1. `apps/server/src/modules/tenders/tender-pdf-boilerplate.ts`** (new)

Move `PAGE_BREAK_BLOCK`, `PAGENUM_TOKEN`, `TOTALPAGES_TOKEN`, `normalizeBlockWhitespace`,
`toWhitespaceTolerantPattern`, and `stripPageBoilerplate` out of `tender-item.parser.ts` verbatim
(keep their doc comments — they already explain the `*`-vs-digit total-page-count and
title-wrap fixes from today's earlier bugfix). Export only `stripPageBoilerplate(text: string):
string`; the rest stay private to this file. Pure extraction, no behavior change — this is the
shared home so the new notes-section parser can reuse the just-fixed, just-tested stripping logic
instead of writing a second bespoke one (per this repo's "generic infra — reuse, don't fork"
convention).

**2. `apps/server/src/modules/tenders/tender-item.parser.ts`** (modify)

Delete the moved block, `import { stripPageBoilerplate } from "./tender-pdf-boilerplate.js";`.
`parseIiscoRfqItems` body unchanged. Run `tender-item.parser.spec.ts` right after this step alone
— its 3 existing tests exercise `stripPageBoilerplate` indirectly and should pass unchanged,
proving the move was purely mechanical before building on top of it.

**3. `apps/server/src/modules/tenders/tender-notes-sections.parser.ts`** (new)

Same null-fallback convention as `parseIiscoHeaderFields`/`parseIiscoRfqItems`. Runs against
**layout-mode** text (`{ layout: true }`, same mode `parseIiscoRfqItems` already uses) — a
document's section headings/table shape survive page breaks intact under `-layout`, and that's
exactly where the just-fixed `stripPageBoilerplate` applies.

```ts
export type NoteSectionKey = "rfqDescription" | "nit" | "itt" | "grnNote";
export interface ExtractedSection { key: NoteSectionKey; heading: string; text: string; }

export function parseIiscoNoteSections(text: string): ExtractedSection[] | null
```

Anchors (verified against the real layout-mode text of TE No 1400014147):
- `RFQ_DESC_HEADING = /RFQ Description\s*:/`
- `NIT_HEADING = /Notice Inviting Tender\s*\(NIT\)\s*:/`
- `ITT_HEADING = /Instructions to Tenderers\s*\(ITT\)\s*:/`
- `ITEM_TABLE_HEADING = /Sl\s*No\s+Item\s*Code\s+Qty\s+UoM/` (hard stop before the item table)
- `GRN_NOTE_START = /Note\s*:\s*SAIL ISP shall issue the Goods Receipt and\s+Acceptance Note\s*\(GRN\)/i`

Gate: `if (!NIT_HEADING.test(text) && !ITT_HEADING.test(text)) return null;` (RFQ Description alone
is too generic a heading to safely anchor on). Then `stripPageBoilerplate(text)` before any
section slicing.

**The GRN-note-appears-twice problem**: the GRN note is reprinted verbatim once glued onto NIT's
tail and again onto ITT's tail (confirmed in the real document — the mid-page-break split even
lands inside the note's own sentence, "...under the Bidder's" / [page break] / "Manual tab.",
which is exactly why `stripPageBoilerplate` must run first, not as a nice-to-have). Solved with a
`captureSection(text, start, endCandidates[], opts?)` helper: slice from `start`'s match to
whichever `endCandidates` regex matches *soonest after that point* (plain non-global `.match()` on
`text.slice(bodyStart)` — nearest wins, no manual "match #2" bookkeeping needed):
- `rfqDescription`: start `RFQ_DESC_HEADING`, end-candidates `[NIT_HEADING, ITT_HEADING,
  ITEM_TABLE_HEADING]`.
- `nit`: start `NIT_HEADING`, end-candidates `[GRN_NOTE_START, ITT_HEADING, ITEM_TABLE_HEADING]`
  — the nearest `GRN_NOTE_START` after NIT's start is its own trailing (first) copy, so NIT's text
  stops before it, correctly.
- `itt`: start `ITT_HEADING`, end-candidates `[GRN_NOTE_START, ITEM_TABLE_HEADING]` — searching
  from ITT's own start, the first GRN copy (which precedes ITT) is out of range, so the nearest
  match is automatically the *second* (ITT-tail) copy — same mechanism, no special-casing.
- `grnNote`: start `GRN_NOTE_START` with `includeStart: true` (its matched phrase IS the note's own
  opening sentence, unlike the other three anchors which are separate heading labels), end-
  candidates `[ITT_HEADING, ITEM_TABLE_HEADING]` — `text.match()` un-sliced finds the *first*
  occurrence only, giving one deduplicated copy.

Push order in the returned array: `rfqDescription, nit, itt, grnNote` (Note last, matching how the
sections were listed when scoping this) — a two-line change if first-appearance order is wanted
instead. Only push a section if its capture is non-null/non-empty; return `null` overall if nothing
was found.

**4. `apps/server/src/modules/tenders/__tests__/tender-notes-sections.parser.spec.ts`** (new)

Hand-adapted real `pdftotext -layout` excerpts (cite TE No 1400014147), same style as
`tender-item.parser.spec.ts`. Cases:
- Returns `null` for text with neither NIT nor ITT heading.
- Full-shape case (RFQ Description → NIT with its GRN copy *including an embedded page-break
  block splitting the note's sentence* → ITT with its own GRN copy → item-table header): assert
  `sections.map(s => s.key)` is the 4 keys in the fixed order; `nit.text` and `itt.text` do **not**
  contain `"Note: SAIL ISP shall issue"`; the combined text of all sections contains that phrase
  exactly once (dedup proof); no section's text contains `Page \d+`/`IISCO STEEL PLANT` boilerplate
  (proves `stripPageBoilerplate` ran first). This is the test that locks in the trickiest part.
- Partial-document case (ITT only, no NIT/RFQ Description/GRN note) still returns a 1-element
  array, not `null`.

No separate spec needed for `tender-pdf-boilerplate.ts` — covered by `tender-item.parser.spec.ts`'s
existing 3 tests (unchanged by the move) plus the page-break case above.

**5. `apps/server/src/modules/tenders/tender-extraction.service.ts`** (modify)

Fetch layout-mode text before notes extraction so it's available to the new path (item-fetch call
order is unchanged, so the existing "calls happen in order `[{layout:undefined},{layout:true}]`"
test still passes):

```ts
const text = await this.extractText(buffer, mimeType);
const itemsText = await this.extractText(buffer, mimeType, { layout: true });
const items = parseIiscoRfqItems(itemsText);
const notes = await this.extractNotes(text, itemsText, warnings);
```

`extractNotes` branches on the new parser first, falling back to today's existing logic untouched
if it returns `null`:

```ts
private async extractNotes(text: string, layoutText: string, warnings: string[]) {
  const sections = parseIiscoNoteSections(layoutText);
  if (sections) return this.extractNotesFromSections(sections, warnings);
  // unchanged: today's single NOTES_PROMPT call -> parseTenderNotes fallback -> cleanupNotes
  ...
}

private async extractNotesFromSections(sections: ExtractedSection[], warnings: string[]) {
  const cleanedParts = await Promise.all(sections.map((s) => this.cleanSection(s, warnings)));
  return cleanupNotes(cleanedParts.join("\n\n")) || undefined;
}

private async cleanSection(section: ExtractedSection, warnings: string[]): Promise<string> {
  const raw = `## ${section.heading}\n${section.text.replace(/\s+/g, " ").trim()}`;
  if (!env.TENDER_NOTES_AI_ENABLED) return raw;
  try {
    const cleaned = stripCodeFence(await this.generateText(buildSectionCleanupPrompt(section)));
    return cleaned || raw;
  } catch {
    warnings.push(`AI notes extraction was unavailable for "${section.heading}" — used the raw extracted text.`);
    return raw;
  }
}
```

New narrower per-section prompt (near `NOTES_PROMPT`) — the job is now just "format this one
already-identified, already-bounded chunk verbatim," not "find every section yourself":

```ts
function buildSectionCleanupPrompt(section: ExtractedSection): string {
  return `You are formatting ONE already-identified section of a tender document, titled "${section.heading}". Copy it VERBATIM — do not paraphrase, summarize, shorten, translate, or add anything not in the text.

Rules — follow exactly:
- Output exactly one "## ${section.heading}" line, followed by the content.
- Put each distinct point on its own line starting with "- ", copied word for word. If several points are run together (e.g. "1.Inspection... 2.Material..." or separated by "#"), split them so each point is on its own line.
- Do not invent, rename, merge, reorder, or add any heading other than the one given above.
- Output ONLY the markdown (no preamble, no explanation, no code fences).

Text:
"""
${section.text.slice(0, MAX_NOTES_CHARS)}
"""`;
}
```

Design decisions:
- **Ordering under parallelism**: `Promise.all(sections.map(...))` — results come back in input-
  array order regardless of resolution order (language guarantee), and `sections` is already in
  fixed document order from the parser. No manual reassembly/sorting needed.
- **`cleanupNotes()` placement**: run once, over the full concatenation of all 4 (AI-cleaned or
  raw-fallback) parts — not once per section. It already processes `## heading` blocks
  independently internally, so this is simpler and behaves the same either way.
- **One section's AI call failing**: caught inside `cleanSection` so `Promise.all` never rejects —
  that section falls back to its own raw regex-captured text (still labeled, still passed through
  the final `cleanupNotes()`), plus one `warnings` entry naming it. Not dropped, not a whole-
  document fallback. This is a local-dev-only AI feature (no cost/key, per project docs) so no
  `allSettled`/retry/timeout infrastructure is being added here — matches today's existing
  no-timeout `generateText` behavior, just now up to 4 concurrent calls instead of 1.
- `parseIiscoHeaderFields`'s own `remarks`/`ITT_BLOCK` (tender-header.parser.ts) becomes largely
  redundant with the new ITT section for IISCO docs — noted, not touched (the frontend never reads
  `remarks` today anyway, so nothing currently depends on it).
- No changes to `tenders.module.ts` — `TenderExtractionService`'s constructor is unchanged;
  `parseIiscoNoteSections` is imported directly, same convention as the header/item parsers.

**6. `apps/server/src/modules/tenders/__tests__/tender-extraction.service.spec.ts`** (modify)

Extend using the existing fake-`generateText` pattern. Add:
- A fixture built from a trimmed real layout-mode excerpt fed through a fake `extractText` that
  returns it for the layout-mode call specifically. A fake `generateText` returning a
  distinguishable, per-prompt string, resolving with **staggered/reversed delays** to prove
  out-of-order resolution doesn't reorder the final `notes` string — assert section order.
- A variant where the fake `generateText` throws for exactly one section (match on a distinctive
  substring in its prompt) and resolves normally for the rest — assert the other three sections'
  output still appears, the failed section's raw text still appears (labeled), and `warnings`
  contains one entry naming it.
- Assert `generateText` is called 4 times with 4 distinct prompts (none equal to the old
  whole-document `NOTES_PROMPT`) for this fixture.
- The existing "extracts fields deterministically..." test (line ~234, `IISCO_TEMPLATE_TEXT`
  fixture) already contains an `Instructions to Tenderers (ITT) :` heading, so it will now also
  exercise the new sectioned path (its shared `fakeGenerateText` returns `""`, so it falls back to
  raw section text) — it doesn't currently assert on `notes`/`warnings` so it won't fail, but add
  an explicit assertion locking in what `notes` becomes for that fixture so a future change to the
  new path can't regress silently without a test noticing.
- Fixtures with no NIT/ITT heading (`SAMPLE_PDF_TEXT_RESULT`/`TEXT_WITH_ONE_ITEM`/etc.) get `null`
  from `parseIiscoNoteSections` and keep exercising the untouched old path exactly as today — no
  changes needed there beyond confirming they still pass.
- The `cleanupNotes()` unit test (line ~338) calls `cleanupNotes()` directly, not through the
  service — entirely unaffected by this change.

## Verification

1. `pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tender-item.parser.spec.ts`
   right after step 2 (the boilerplate move) — checkpoint that the move was mechanical.
2. `pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tender-notes-sections.parser.spec.ts`
   — new parser's dedup/boundary behavior, including the page-break-mid-sentence case.
3. `pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tender-extraction.service.spec.ts`
   — full suite including the new parallel-call ordering/failure-handling cases and the updated
   existing test.
4. `pnpm --filter @bmp/server typecheck` and `pnpm --filter @bmp/server exec eslint` on all touched
   files.
5. Live end-to-end check: with the real dev server + Ollama running, re-upload
   `~/Downloads/BID1400014147.PDF` through `/tenders/new` (same manual flow used earlier this
   session) and confirm the "Terms & Notes" box now shows `## RFQ Description` / `## Notice
   Inviting Tender (NIT)` / `## Instructions to Tenderers (ITT)` / `## Note` blocks with verbatim
   bullet points (warranty/delivery visible under ITT) instead of AI-summary prose — do not submit
   this test tender; discard it (or reuse the delete flow from earlier) once confirmed, so a
   duplicate `1400014147` doesn't linger.

## Open items (not blocking, flagged for awareness)

- `GRN_NOTE_START` is a ~9-word literal-phrase regex, verified against one real document; if a
  different IISCO/SAIL tender rewords that sentence, the section/boundary trick riding on it
  silently degrades to the `ITT_HEADING`/`ITEM_TABLE_HEADING` end-candidates instead of hard-
  failing — graceful, but unproven against a second real sample.
- `RFQ Description`'s extracted content is largely a run-on restatement of the items table (already
  shown separately in the Items tab) — kept in scope since it was explicitly requested, but expect
  it to read as low-value noise in the rendered panel.
- Two unrelated stray duplicate files already exist in this directory (`tender-notes.parser 2.ts`,
  `__tests__/tender-notes.parser.spec 2.ts`) — not part of this change, but worth a separate
  cleanup pass since a naive glob could pick them up.
