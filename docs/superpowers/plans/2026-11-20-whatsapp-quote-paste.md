# WhatsApp Quote Paste + Prompt Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a vendor's WhatsApp reply on an RFQ, get per-item rates (rules first, local AI for leftovers), review, save; plus an editable "AI prompts" settings section holding that prompt.

**Architecture:** Pure rule parser + a separate AI-fallback module (both in `modules/rfq/`, no DB), composed by two new `RfqService` methods (preview, bulk save). The AI reader is injected into `RfqService` as one function built in `rfq.module.ts` from `generateJson` + `settingsService.get("PROMPT_RFQ_QUOTE_PASTE")`, same injection style as `client-purchase-orders.module.ts`. Prompt store = new `"prompt"` setting type in the existing settings registry.

**Tech Stack:** Express + Zod + Prisma (existing Setting table, no migration), Vitest, Next.js + TanStack Query + `@bmp/ui`.

**Spec:** `docs/superpowers/specs/2026-11-20-whatsapp-quote-paste-design.md`

## Global Constraints

- No Prisma migration: prompts live in the existing `settings` table.
- AI call: one `generateJson` call per preview, `timeoutMs: 30_000`, `temperature: 0`, JSON `schema` passed; default model (`env.OLLAMA_MODEL`, like every other call today).
- AI answer rejected unless: line id was sent, `itemNumber` in range and not already matched, rate digits appear in that line (comma-insensitive), not both rate and regret.
- Ollama failure never fails the request: `aiNotice = "AI reader unavailable — N lines left for you to fill"`.
- GST notice text: `"Vendor mentions GST — check whether rates include it"`.
- Paste text max 20 000 chars. Prompt value max 20 000 chars.
- Audit action for bulk save: `RFQ_QUOTES_PASTED`, metadata `{ vendorId, imported, aiCount }`. Reset audit: `SETTING_RESET`.
- Fixtures anonymised: no real vendor, RFQ number, business names (repo is public).
- UI copy: button "Paste WhatsApp quote", "Read rates", "Save N quotes", "Reset to default", "Reading…"/"Saving…" with the ellipsis character.

## Review Focus

1. Description numbers that equal the rate or qty (e.g. `(10X150)` with `150@10/-`) — leftover-number removal must remove one occurrence per token, not all. Test in Task 2.
2. Windows/WhatsApp-desktop paste with `\r\n` and non-breaking spaces — must read identically. Test in Task 2.
3. WhatsApp forward prefixes like `[20/11, 10:42 am] Vendor:` before the first line — the timestamp numbers must not become a serial or rate. Test in Task 2.
4. Re-pasting for a vendor who already has quotes — only mentioned items change. Test in Task 4 (integration).
5. Finalized RFQ / uninvited vendor on preview — 409 / 400 before any parsing or AI call. Test in Task 4.

---

### Task 1: Prompt store (types, registry, service, reset route, settings UI)

**Files:**
- Modify: `packages/types/src/settings.ts` — add key `"PROMPT_RFQ_QUOTE_PASTE"` to `SETTING_KEYS`; `SettingValueType` gains `"prompt"`; `SettingDto` gains `requiredMarkers: string[]` and `defaultValue: string | number | boolean`.
- Modify: `apps/server/src/modules/settings/settings.registry.ts` — `SettingDefinition` gains `requiredMarkers?: string[]`; add `PROMPT_RFQ_QUOTE_PASTE` (group `"AI prompts"`, label `"Vendor WhatsApp quote reader (RFQ)"`, `requiredMarkers: ["items", "lines"]`, `defaultValue: RFQ_QUOTE_PASTE_DEFAULT_PROMPT`).
- Create: `apps/server/src/infra/llm/prompts.ts` — `renderPrompt`, `missingMarkers`, and `RFQ_QUOTE_PASTE_DEFAULT_PROMPT`.
- Modify: `settings.service.ts` (`set` validates prompts; new `reset(key, actorId)`), `settings.repository.ts` (`delete(key)`), `settings.controller.ts` (`reset`), `settings.routes.ts` (`DELETE /:key`, `settings:manage`, `@openapi`), `settings.validation.ts` (value string max 20 000).
- Modify: `apps/web/src/hooks/use-settings.ts` (`useResetSetting`), `apps/web/src/app/(dashboard)/settings/page.tsx` (`prompt` → full-width monospace `Textarea`, marker hint, Save on explicit button rather than blur, "Reset to default" when `isOverridden`).
- Test: `apps/server/src/modules/settings/__tests__/settings.service.spec.ts`, `apps/server/src/infra/llm/__tests__/prompts.spec.ts`

**Interfaces:**
- Produces: `renderPrompt(template: string, values: Record<string, string>): string` (replaces every `{{name}}`; unknown markers left as-is); `missingMarkers(template: string, required: string[]): string[]`; `RFQ_QUOTE_PASTE_DEFAULT_PROMPT: string`; `settingsService.get<string>("PROMPT_RFQ_QUOTE_PASTE")`.

- [ ] **Step 1: Failing tests**
  - `prompts.spec.ts`: `renderPrompt("A {{x}} B {{x}} {{y}}", { x: "1" })` → `"A 1 B 1 {{y}}"`; `missingMarkers("{{items}} only", ["items","lines"])` → `["lines"]`; default prompt contains `{{items}}` and `{{lines}}`.
  - `settings.service.spec.ts`: `set("PROMPT_RFQ_QUOTE_PASTE", "no markers", actor)` rejects with `BadRequestError` whose message names `{{items}}` and `{{lines}}`; `set` with both markers upserts; `reset` calls repository `delete` and audit `SETTING_RESET`, returns DTO with `isOverridden: false` and default value; `listAll` DTO for the prompt key has `requiredMarkers: ["items","lines"]`. (Extend the existing fake repository with `delete`.)
- [ ] **Step 2: Run** `pnpm --filter @bmp/server exec dotenv -e ../../.env.test -- vitest run src/infra/llm/__tests__/prompts.spec.ts src/modules/settings` — expect FAIL.
- [ ] **Step 3: Implement.** Default prompt must state: per-unit rate (in `150@10/-`, 150 is quantity and 10 is rate); sizes/dimensions in descriptions are never prices; `itemNumber` is the number from the `{{items}}` list the line refers to; return `null` instead of guessing; exactly one object per input line, echoing its `L<n>` id. Type `"prompt"` parses/serialises as string.
- [ ] **Step 4: Run tests** — expect PASS. Then `pnpm --filter @bmp/web typecheck` (dev server stopped) — expect clean.
- [ ] **Step 5: Commit** `feat(settings): editable AI prompt settings with marker validation and reset`

### Task 2: Rule-based quote text parser

**Files:**
- Create: `apps/server/src/modules/rfq/whatsapp-quote-parser.ts`
- Test: `apps/server/src/modules/rfq/__tests__/whatsapp-quote-parser.spec.ts`

**Interfaces:**
- Consumes: `specNumbers` from `shared/utils/spec-match.ts`.
- Produces:
```ts
export interface PasteItem { description: string; quantity: number; unit: string | null } // index i ⇒ Sl No i+1
export interface PasteLine { lineIndex: number; text: string }
export interface PasteMatch {
  itemIndex: number; lineIndex: number; rate: number | null; regretted: boolean;
  vendorQuantity: number | null; source: "serial" | "description" | "ai"; warnings: string[];
}
export interface UnreadLine extends PasteLine { reason: string }
export interface ParsedQuoteText { matches: PasteMatch[]; unread: UnreadLine[]; gstMentioned: boolean }
export function parseQuoteText(text: string, items: PasteItem[]): ParsedQuoteText;
```

Rules exactly as spec §"Server — parse" steps 1–3. Additions decided here:
- Normalise `\r\n`, ` ` → space before anything.
- Strip a leading WhatsApp header `^\[[^\]]*\]\s*[^:]{1,60}:\s*` from each line.
- "Leftover numbers" = all numbers on the line minus one occurrence each of serial, vendor qty and rate.
- Word-overlap tie-break: best score ≥ 2 × second and ≥ 2 shared tokens; else unread.
- `gstMentioned`: `/\bgst\b|\bincl(usive)?\b|\+\s*18\s*%|\bextra\b/i` anywhere in text.

- [ ] **Step 1: Failing tests** (fixture = the 25-line O-ring sample from the spec, items = matching 25 descriptions with qty 150/100):
  - `it("reads qty@rate lines by serial")`: 25 matches, all `source: "serial"`, rates `[10,10,12,12,15,15,15,20,20,20,20,25,25,25,25,30,30,10,10,10,10,15,20,60,12]`, `vendorQuantity` 150 for 1–17 and 100 for 18–25, no unread.
  - `it("matches by description when serials are missing")`: same lines with the leading serial removed and order shuffled → same item→rate pairs, `source: "description"`.
  - `it("prefers description when serial points elsewhere")`: line `3 "O" RING (12X1.5) MM EA 150@10/-` → itemIndex 1, warning `"Serial 3 points at a different item"`.
  - `it("accepts bare serial lines")`: `3 - 450` → item 2 rate 450.
  - `it("reads regrets")`: `4 regret`, `5 - not available`, `6 NA` → `regretted: true, rate: null`.
  - `it("reads rupee and per-unit forms")`: `Rs 1,250/-` → 1250; `@ 450 per mtr` → 450; `₹ 99.50` → 99.5.
  - `it("ignores chatter")`: `Good morning sir`, `Regards` → neither match nor unread.
  - `it("flags duplicate claims")`: two lines with serial 1 → second unread, reason `"Item 1 already matched by line 1"`.
  - `it("removes only one occurrence of rate/qty from leftovers")`: item `"PLATE (10X150)"`, line `1 PLATE (10X150) NOS 150@10/-` → serial match, no warning.
  - `it("handles CRLF, nbsp and WhatsApp headers")`: `[20/11, 10:42 am] Supplier: 1 O RING (12X1) MM EA 150@10/-\r\n` → item 0 rate 10.
  - `it("detects GST wording")`: `"rates + GST extra"` → `gstMentioned: true`; O-ring sample → false.
  - `it("leaves prose unread")`: `all rings same rate as last time` → in `unread`.
- [ ] **Step 2: Run** `pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/whatsapp-quote-parser.spec.ts` — expect FAIL.
- [ ] **Step 3: Implement `parseQuoteText`.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(rfq): rule-based WhatsApp quote text parser`

### Task 3: AI fallback for unread lines

**Files:**
- Create: `apps/server/src/modules/rfq/quote-paste-ai.ts`
- Test: `apps/server/src/modules/rfq/__tests__/quote-paste-ai.spec.ts`

**Interfaces:**
- Consumes: `PasteItem`, `UnreadLine`, `PasteMatch` (Task 2); `renderPrompt` (Task 1).
- Produces:
```ts
export type QuotePasteAiReader = (items: PasteItem[], lines: UnreadLine[], takenItemIndexes: Set<number>)
  => Promise<{ matches: PasteMatch[]; remaining: UnreadLine[]; notice: string | null }>;
export function createQuotePasteAiReader(deps: {
  getTemplate: () => Promise<string>;
  generate: (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;
}): QuotePasteAiReader;
```
`{{items}}` = `N | description | qty | unit` per item; `{{lines}}` = `L<lineIndex>: <text>` per line. Zod-validate `{ lines: [{ line, itemNumber, rate, regretted }] }`; apply Global Constraints hard checks; accepted → `source: "ai"`, `warnings: []`; `remaining` keeps original reasons. Empty `lines` → return immediately without calling `generate`. `generate` throws or Zod fails → `matches: []`, `remaining: lines`, notice per Global Constraints.

- [ ] **Step 1: Failing tests** (fake `generate` returning canned JSON, capturing prompt):
  - `it("does not call the model with no lines")`.
  - `it("renders items and lines into the template")`: prompt contains `1 | O RING (12X1) MM | 150 | EA` and `L4: all 33mm ones 25 each`.
  - `it("accepts a grounded answer")`: line `L4: 33mm one twenty five rupees 25` + answer `{itemNumber: 12, rate: 25}` → match itemIndex 11, rate 25, source "ai".
  - `it("drops an invented rate")`: answer rate 30 not in text → no match, line in `remaining`.
  - `it("drops out-of-range and taken items")`: itemNumber 99, and itemNumber already in `takenItemIndexes` → dropped.
  - `it("drops unknown line ids and rate+regret together")`.
  - `it("degrades when the model fails")`: `generate` rejects → `notice: "AI reader unavailable — 1 lines left for you to fill"`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(rfq): AI fallback reader for unparsed quote lines`

### Task 4: Service methods, routes, DTOs, wiring

**Files:**
- Modify: `packages/types/src/rfq.ts` — add `QuotePastePreviewDto` exactly as spec (§Response, incl. `gstNotice`), `ParseQuoteTextInput { vendorId; text }`, `SaveQuotesInput { vendorId; quotes: { rfqItemId; rate?; regretted? }[] }`, `SaveQuotesResultDto { imported: number }`.
- Modify: `apps/server/src/modules/rfq/rfq.validation.ts` — `parseQuoteTextSchema` (uuid, text 1..20 000), `saveQuotesSchema` (1..500 rows, each refine rate xor regretted, rate > 0).
- Modify: `rfq.service.ts` — constructor 12th param `quotePasteAi: QuotePasteAiReader`; `previewQuotePaste(rfqId, vendorId, text, businessId): Promise<QuotePastePreviewDto>`; `saveQuotes(rfqId, vendorId, quotes, aiCount, actorId, businessId): Promise<SaveQuotesResultDto>`; extract private `writeVendorQuotes(rfq, invite, rows)` shared with `importQuotes` (upsert, autoSelectLowest, invite → RESPONDED when imported > 0).
- Modify: `rfq.controller.ts`, `rfq.routes.ts` (`POST /:id/quotes/parse-text`, `POST /:id/quotes/bulk`, both `rfq:update`, `@openapi`), `rfq.module.ts` (build reader: `getTemplate = () => settingsService.get<string>("PROMPT_RFQ_QUOTE_PASTE")`, `generate = (p, schema) => generateJson(p, undefined, { schema, timeoutMs: 30_000, temperature: 0 })`).
- Modify: `__tests__/rfq.service.spec.ts` constructor call (pass a fake reader).
- Test: `__tests__/rfq.service.spec.ts` (new describe), `__tests__/rfq-quotes.integration.spec.ts` (new cases).

**Decisions:** `saveQuotes` body carries `aiCount` (client counts rows whose source was `ai`; audit-only, trusted as metadata). `currentRate`/`currentRegretted` come from the vendor's existing `RfqQuote` on each item. Quantity warning text: `"Vendor quoted for {v}, RFQ asks {q}"` when `vendorQuantity !== quantity`. Preview items always list every RFQ item in Sl No order.

- [ ] **Step 1: Failing tests**
  - Unit: preview on finalized RFQ → `ConflictError`, reader not called; uninvited vendor → `BadRequestError`; sample text → 25 items with source serial; reader called only with unread lines and `takenItemIndexes` from rule matches; `gstNotice` set when text says GST.
  - Integration: create RFQ with 3 items + invited vendor with an existing quote on item 3; `parse-text` with `1 - 100\n2 regret` → item1 rate 100, item2 regretted, item3 `currentRate` preserved and `rate: null`; `bulk` with those two rows → 200 `{ imported: 2 }`, item 3 quote unchanged, invite status `RESPONDED`, audit row `RFQ_QUOTES_PASTED`; `bulk` on CLOSED RFQ → 409.
- [ ] **Step 2: Run** unit + `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/rfq` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS; `pnpm --filter @bmp/server typecheck` clean.
- [ ] **Step 5: Commit** `feat(rfq): preview and save vendor quotes pasted from WhatsApp`

### Task 5: Paste dialog on RFQ page

**Files:**
- Modify: `apps/web/src/hooks/use-rfq.ts` — `useParseQuoteText(rfqId)` (mutation, no invalidation), `useSaveQuotes(rfqId)` (invalidate rfq + comparison like `useImportQuotes`).
- Create: `apps/web/src/components/rfq/quote-paste-dialog.tsx` — `QuotePasteDialog({ rfqId, vendors, disabled }: { rfqId: string; vendors: { id: string; name: string }[]; disabled: boolean })`.
- Modify: `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx` — render dialog trigger beside `QuoteSheetActions` when `hasPermission(roleName, "rfq:update")`; `disabled` when RFQ status CLOSED/CANCELLED.

Dialog per spec §"UI — preview table": step 1 vendor `Select` (bind to `""`, no sentinel) + `Textarea` + "Read rates"; step 2 table with editable rate `Input` (string state), regret `Checkbox` (checking clears rate), source `Badge` (Serial / Description / AI — AI uses a distinct variant), struck-through `formatMoney(currentRate)` when changed, amber warnings, unmatched lines list, `aiNotice`/`gstNotice` banners. Footer: `DialogClose` Cancel, then "Save N quotes" (N = rows with rate > 0 or regret; disabled at 0). Success toast `"Saved N quote(s)"`, close dialog, reset state.

- [ ] **Step 1:** Implement hooks + dialog + page wiring.
- [ ] **Step 2:** `pnpm --filter @bmp/web lint && pnpm --filter @bmp/web typecheck` (dev server stopped) — expect clean.
- [ ] **Step 3: Commit** `feat(web): paste WhatsApp quote dialog on RFQ page`

### Task 6: Wrap-up

- [ ] Full `pnpm lint`, `pnpm typecheck`, `pnpm test` (sequential, dev server stopped) — report failures verbatim, distinguishing pre-existing ones.
- [ ] `graphify update .`
- [ ] Project memory file `project_whatsapp_quote_paste.md` + MEMORY.md line.
- [ ] Commit `chore: graph + docs for WhatsApp quote paste`.
