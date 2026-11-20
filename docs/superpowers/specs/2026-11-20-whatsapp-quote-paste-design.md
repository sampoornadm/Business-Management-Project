# WhatsApp quote paste + editable AI prompts (Part 1) — design

Date: 2026-11-20 · Status: draft, awaiting owner approval

## Intent

Vendors answer RFQs on WhatsApp, not with the Excel quote sheet. Today someone retypes every
rate into the RFQ page cell by cell. The owner wants a box on the RFQ page: pick a vendor, paste
the WhatsApp reply, and the app fills that vendor's rates by matching each line to an RFQ item
(by serial number or by description), shown for review before saving.

Alongside it, the owner wants every AI prompt in the app editable from Settings. Part 1 builds
that prompt store and puts this feature's prompt in it. Part 2 (moving the 11 existing prompts
into the store) is deferred — tracked in memory, not in this doc.

## Real input

A real reply (anonymised for the repo), tab-separated, numbered to match our own
"Copy for WhatsApp" list (`buildRfqWhatsappText`, `Sl No. | Item Desc | Qty | UoM`):

```
1	"O" RING : ID X THICKNESS : (12X1) MM	EA	150@10/-
2	"O" RING : ID X THICKNESS : (12X1.5) MM	EA	150@10/-
...
24	"O" RING : ID X THICKNESS : (85X3.75)MM	EA	100@60/-
25	"O" RING : ID X THICKNESS : (16X1.75)MM	EA	100@12/-
```

`150@10/-` = quantity 150 at ₹10 each, so the rate is **10**, not 150. Descriptions carry their own
numbers (`12X1`, `12X1.5`), which are specs, not prices.

## Goals

- Paste a vendor's WhatsApp text and get one proposed rate (or regret) per RFQ item.
- Matching: serial number first, description second, local AI only for lines neither rule can read.
- Nothing is saved until the user reviews and confirms; every proposed value is editable.
- Saved quotes behave exactly like quote-sheet imports (lowest-rate auto-select, invite status
  → Responded, audit log).
- A Settings section "AI prompts" where the quote-paste prompt can be edited and reset.

## Non-goals (v1)

- Parsing make/model or technical deviation from the text (still editable per quote as today).
- Per-business prompts (settings are global, like every other setting).
- Migrating the other 11 prompts (Part 2).
- Reading images/PDFs forwarded on WhatsApp — text paste only.
- Picking the vendor automatically from the text.

## Anti-goals

- A rate attached to the wrong item without the user seeing it. A wrong price in a live bid is
  the worst outcome; an unmatched line is an acceptable one.
- An AI-produced number that the vendor never wrote.
- An edited prompt able to write malformed data into quotes.

## Approaches considered

- **A. Rule-based reader only.** Instant, deterministic, no Ollama. Fails on free prose.
- **B. Ollama reads the whole message.** Handles prose, but 20–60 s per message and small local
  models are already measured here inventing values and dropping lines.
- **C. A first, B only for lines A could not read.** ← **Owner's pick.** Deterministic for the
  common shape (the sample above is 100% rule-readable), AI as a safety net for messy lines.

## Design

### Flow

1. RFQ page, "Items & quotes" card header, next to `QuoteSheetActions`: outline button
   **"Paste WhatsApp quote"** (hidden without `rfq:update`, disabled on a finalized RFQ).
2. Dialog: vendor select (invited vendors only, same list `QuoteSheetActions` uses), a large
   textarea, **"Read rates"** button.
3. Server parses and returns a preview (no writes).
4. Dialog shows the preview table; user edits; **"Save N quotes"** writes.

### Server — parse (no writes)

`POST /rfqs/:id/quotes/parse-text` · `rfq:update` · body `{ vendorId, text }` (text ≤ 20 000 chars).
Same guards as `importQuotes`: RFQ in business, not finalized, vendor invited.

New pure module `apps/server/src/modules/rfq/whatsapp-quote-parser.ts`:

**Step 1 — lines.** Split on newlines; drop blank lines and lines with no digit at all
(greetings, "Regards"). Keep a line index for each.

**Step 2 — rule reading (A), per line:**
- *Serial:* a leading integer (`^\s*(\d{1,3})\s*[.)\-:|\t]`, or a leading integer followed by
  whitespace). Valid only if 1 ≤ n ≤ item count.
- *Regret:* line contains (case-insensitive) `regret`, `not available`, `n/a`, `NA` as a word,
  `not quoting`, `no quote`, `nil` as the price token → regretted, no rate.
- *Rate,* first pattern that hits wins:
  1. `qty@rate` — `(\d[\d,]*(?:\.\d+)?)\s*@\s*(?:rs\.?|₹)?\s*(\d[\d,]*(?:\.\d+)?)` → rate =
     group 2, vendor quantity = group 1.
  2. `@ rate` with no quantity before it → rate.
  3. `rs`/`₹`/`inr` followed by a number → rate.
  4. A number followed by `/-` → rate.
  5. Otherwise: the last number on the line, **only** when the line splits into ≥ 3 tab- or
     `|`-separated cells and that number is the whole last cell.
  Commas are stripped (`1,250` → 1250). Rate must be > 0.
- A line with a serial and a rate (or regret) is **rule-read**.

**Step 3 — matching a rule-read line to an item:**
- Item numbering = RFQ items in `sortOrder` (the same order `buildRfqWhatsappText` numbers them).
- *Serial check:* if the line has a serial, take item N. Then cross-check the description:
  remove the serial, quantity and rate tokens from the line, and check every spec number of
  item N's description (`specNumbers()` from `shared/utils/spec-match.ts`) appears in what's
  left. Pass → match by **serial**. Fail → try description matching; if that finds a different
  unique item, use it and add warning "Serial N points at a different item"; otherwise keep
  item N with warning "Description doesn't match item N".
  If the line has no description text at all (e.g. `3 - 450`), serial alone is accepted.
- *Description match (no serial, or failed cross-check):* candidates = items all of whose spec
  numbers appear in the line's leftover numbers. Exactly one → match by **description**. Zero
  or several → tie-break by word overlap (lower-cased alphanumeric tokens, ≥ 3 chars) only if the
  best beats the second by a clear margin (builder sets it, documented); otherwise unread.
  Items with no spec numbers at all match by word overlap only, same margin rule.
- Two lines claiming the same item: keep the first, mark the second unmatched with warning
  "Item N already matched by line X".

**Step 4 — AI fallback (B), only for lines A could not read:** lines with digits but no
rate/regret found, or no item match. If none, Ollama is never called.
- One `generateJson` call, model `OLLAMA_MODEL` setting, 30 s timeout, temperature 0, with a
  JSON schema (`format`) so the shape is grammar-constrained.
- Prompt from the prompt store, key `PROMPT_RFQ_QUOTE_PASTE`, markers `{{items}}`
  (numbered `N | description | qty | unit` list) and `{{lines}}` (each unread line as
  `L<index>: <text>`). Default prompt text is written by the builder: it must say the rate is
  the per-unit price (in `150@10`, 10 is the rate), sizes inside descriptions are not prices,
  return `null` rather than guess, and one object per input line.
- Output schema: `{ lines: [{ line: string, itemNumber: integer|null, rate: number|null,
  regretted: boolean }] }`, validated with Zod.
- **Hard checks on every AI answer** (failures drop that answer, the line stays unmatched):
  `line` is one of the sent ids; `itemNumber` in range and not already matched; `rate`'s digits
  appear in that line's text (comma-insensitive); not both rate and regretted.
- Ollama down / timeout / bad JSON → no AI matches, preview carries a notice "AI reader
  unavailable — N lines left for you to fill". Never an error for the whole request.

**Response:**
```ts
interface QuotePastePreviewDto {
  items: Array<{
    rfqItemId: string; slNo: number; description: string; unit: string | null; quantity: number;
    currentRate: number | null; currentRegretted: boolean;   // vendor's existing quote, if any
    rate: number | null; regretted: boolean;                 // proposed
    source: "serial" | "description" | "ai" | null;          // null = nothing found for this item
    vendorLine: string | null; vendorQuantity: number | null;
    warnings: string[];                                       // incl. "Vendor quoted for 100, RFQ asks 150"
  }>;
  unmatchedLines: Array<{ lineIndex: number; text: string; reason: string }>;
  aiNotice: string | null;
  gstNotice: string | null;
}
```
Quantity mismatch is a warning only — the rate is still per unit. If the pasted text mentions
GST anywhere (`gst`, `incl`, `inclusive`, `+18%`, `extra`), the preview shows one top-level
notice "Vendor mentions GST — check whether rates include it"; no automatic conversion.

### Server — save

`POST /rfqs/:id/quotes/bulk` · `rfq:update` · body
`{ vendorId, quotes: [{ rfqItemId, rate?: number, regretted?: boolean }] }` (each row: rate xor
regretted, same refine as the single-quote route). Writes through the same loop as
`importQuotes` — extract that loop into one private method both call (upsert, auto-select
lowest, invite → Responded, one audit entry, action `RFQ_QUOTES_PASTED`, metadata
`{ vendorId, imported, aiCount }`). Items absent from `quotes` are left untouched. Make/model are
not sent, so existing make/model on a quote is preserved.

### Prompt store

- `SettingValueType` gains `"prompt"`. `SettingDefinition` gains optional
  `requiredMarkers: string[]`. New key `PROMPT_RFQ_QUOTE_PASTE`, group **"AI prompts"**,
  default = the builder's prompt text in code, `requiredMarkers: ["items", "lines"]`.
- `SettingsService.set` for a prompt: refuse (400) if any required marker `{{name}}` is missing.
- Reset to default = delete the override row (new `DELETE /settings/:key`, `settings:manage`,
  audited `SETTING_RESET`), so later improvements to the default reach un-edited installs.
- Rendering helper `renderPrompt(template, values)` in `infra/llm/` — plain `{{name}}`
  replacement; Part 2 reuses it.
- Settings page: `prompt` type renders a monospace `Textarea` (from `@bmp/ui`), with the
  required markers listed under it and a "Reset to default" button when overridden.
- The answer format (JSON schema + Zod + hard checks) stays in code, so prompt edits change
  wording only.

### UI — preview table

Columns: Sl No · Description · RFQ qty · Vendor line (muted, truncated with title tooltip) ·
Rate (editable input, money-formatted on blur) · Regret (checkbox) · source badge
(Serial / Description / **AI** — the AI badge visually distinct) · warnings (amber text).
Rows whose proposed value differs from `currentRate` show the old value struck through.
Unmatched lines listed below the table. Footer: Cancel, then **"Save N quotes"** where N =
rows with a rate or regret. Toast on success; RFQ query invalidated.

## Testing

- Unit (Vitest, pure parser): the anonymised O-ring sample → all 25 matched by serial with
  rates 10/10/12/…; shuffled order; no serials (description match); serial pointing at the
  wrong item; regret lines; `Rs 1,250/-`; `@ 450 per mtr`; greeting/footer lines ignored;
  duplicate item claims.
- Unit: AI hard checks with a fake `generateJson` (invented rate dropped, out-of-range item
  dropped, Ollama throwing → notice).
- Unit: `SettingsService.set` refuses a prompt missing a marker; reset deletes the row.
- Integration: parse-text + bulk save on a real RFQ (quotes written, invite → Responded,
  finalized RFQ → 409).
- Fixtures anonymised (no real vendor, RFQ number or business names).

## Left to the builder

- Exact default prompt wording; word-overlap margin; regex edge details beyond those listed.
- Whether `vendorLine` shows the full line or the leftover after removing serial/qty/rate.
- Component file layout (expected: `apps/web/src/components/rfq/quote-paste-dialog.tsx` +
  hooks in `use-rfq.ts`).

## Calls made without the owner (check these)

1. Make/model/deviation not parsed in v1.
2. Prompts are global, editable by `settings:manage` (same as model settings).
3. One AI call for all unread lines, 30 s timeout, `OLLAMA_MODEL`.
4. AI rate accepted only if its digits appear in the vendor's line.
5. Items the paste didn't mention keep their existing quote.
6. Quantity mismatch warns but doesn't block.
7. GST wording in the paste raises a notice; rates are never auto-adjusted for tax.
