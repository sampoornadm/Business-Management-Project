# SAIL ISP Portal Bid Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that fills the Questions and Items/Conditions pages of a SAIL ISP RFx response from BMP data, reads everything back to diff it, and stores the portal's response number as our bid reference.

**Architecture:** Pure calculation functions (HSN join, weight, GST split, delivery-days parse) feed a `BidPayload` built from the DB. A generic `PortalSession` (Playwright over CDP, attached to the user's own logged-in Chrome) finds fields by label text and writes with real key events. `fill-bid` composes them; a later `capture-opening` workflow reuses `PortalSession`.

**Tech Stack:** TypeScript, Prisma/Postgres, Vitest, `playwright-core` (new dependency in `apps/server`), Express (one small lookup route), Next.js (delivery-period field and badge).

**Spec:** `docs/superpowers/specs/2026-10-26-portal-bid-fill-design.md`

## Global Constraints

- The tool never clicks Save, Check or Submit on the portal. Ever.
- No portal username, password, cookie or `sap-wd-secure-id` is stored, logged or audited.
- `Tender.deliveryPeriodDays` defaults to `120`.
- HSN is the distinct non-empty `hsnCode` values of the current BOQ, first-occurrence order by `sortOrder`, joined with `", "`; one distinct value is written alone.
- Consignment weight is Σ quantity × `unitWeightKg`, written `"<n> Kg"`; if any item lacks a weight the field is untouched and reported.
- GST split is by the first two digits of the supplier GSTIN vs the billing-party GSTIN: equal means CGST = SGST = `gstRate / 2`, IGST 0; otherwise IGST = `gstRate`, CGST = SGST = 0.
- Portal question labels are matched exactly as the portal writes them, typos included (e.g. "avaialble", "declarartion").
- Item rows match portal Product ID to `BoqItem.itemCode`; an unmatched row on either side is reported, never guessed.
- A read-back mismatch fails the run (non-zero exit).
- Follow the repo's module conventions (`*.repository.ts` interface + class, `*.service.ts`, `*.module.ts`); unit tests use hand-written fake repositories, no mocking framework.
- Schema changes go through `pnpm db:migrate:create --name <name>`, edit the SQL, never accept a Prisma "corrective" migration touching the `*_embeddingVector_hnsw_idx` indexes. Run `pnpm db:generate` afterwards.
- New permission keys need `pnpm db:seed` on every environment.

## Review Focus

- A tender whose BOQ items have no HSN at all: the HSN question is skipped with a warning, never typed as an empty string or `"null"`.
- Notes that mention "delivery" without a delivery period ("payment within 30 days of delivery"): must parse to `null`, not 30.
- Notes giving a delivery period in weeks or months ("within 8 weeks", "2 months"): converted to days (56, 60).
- Opened response belongs to a different RFx than the requested tender: abort before typing anything.
- GST rate that doesn't halve cleanly (5 gives 2.5 + 2.5) or is 0; a BOQ item with `rate = null`: reported as unfillable, never sent as 0.

---

### Task 1: Schema, migration, permission

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (`Tender`, `BoqItem`, `Business`; add `PortalBid`, `PortalProfile`)
- Create: `packages/database/prisma/migrations/<timestamp>_portal_bid_fill/migration.sql`
- Modify: `packages/types/src/rbac.ts`

**Interfaces:**
- Produces: `Tender.deliveryPeriodDays Int @default(120)`; `BoqItem.unitWeightKg Float?`; model `PortalBid { id, businessId, tenderId, portalCode String, responseNumber String, status PortalBidStatus, submissionDeadline DateTime?, totalValue Float?, lastFilledAt DateTime?, lastFillSummary Json?, createdAt, updatedAt }` with `@@unique([portalCode, responseNumber])` and `@@unique([tenderId, portalCode])`; enum `PortalBidStatus { SAVED SUBMITTED OPENED }`; model `PortalProfile { id, businessId, portalCode String, answers Json, updatedAt }` with `@@unique([businessId, portalCode])`; permission key `tenders:fill_portal`.

- [ ] **Step 1:** Add the fields and models above to `schema.prisma` (both new models business-scoped like `Boq`; check `scoped-client.ts`'s `SCOPED_MODELS` and add `PortalBid`/`PortalProfile` there).
- [ ] **Step 2:** `pnpm db:migrate:create --name portal_bid_fill`, read the generated SQL, confirm it only adds the columns, enum and two tables. Run `pnpm db:migrate && pnpm db:generate`.
- [ ] **Step 3:** Add `"tenders:fill_portal"` to `PERMISSION_KEYS` in `packages/types/src/rbac.ts` and to `ROLE_PERMISSION_MATRIX` for `ADMIN` and `TENDER_MANAGER` (SUPER_ADMIN is wildcard). Run `pnpm db:seed`.
- [ ] **Step 4:** Run `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit the spec, this plan and the schema: `git add docs packages && git commit -m "feat(portal-bid): schema for portal bids, delivery period, unit weight"`.

### Task 2: Delivery period and unit weight through the API and UI

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.validation.ts`, `tenders.mapper.ts`, `packages/types/src/` (Tender DTO), `apps/server/src/modules/boq/boq.validation.ts`, `boq.mapper.ts` (BoqItem DTO), `apps/web` tender edit form and BOQ item grid.
- Test: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts` (extend).

**Interfaces:**
- Consumes: the Task 1 columns.
- Produces: `TenderDto.deliveryPeriodDays: number`, `BoqItemDto.unitWeightKg: number | null`, both writable on update.

- [ ] **Step 1: Write failing test** `it("persists deliveryPeriodDays on update and defaults new tenders to 120")` and `it("rejects deliveryPeriodDays below 1")`.
- [ ] **Step 2:** Run `pnpm --filter @bmp/server exec vitest run tenders.service` and confirm FAIL.
- [ ] **Step 3:** Add `deliveryPeriodDays: z.coerce.number().int().min(1)` (optional on update) to the tender update schema and `unitWeightKg: z.coerce.number().positive().nullish()` to the BOQ item schema; map both in the mappers and DTO types.
- [ ] **Step 4:** Web: add a "Delivery period (days)" number field to the tender edit form (string in RHF state, converted at submit, per repo convention) and an optional "Unit weight (kg)" column to the BOQ item grid.
- [ ] **Step 5:** Run the spec test (PASS), `pnpm typecheck`, `pnpm lint`; commit `feat(tenders): delivery period and BOQ unit weight fields`.

### Task 3: Delivery days parser and tender badge

**Files:**
- Create: `apps/server/src/modules/tenders/tender-delivery-days.parser.ts`
- Test: `apps/server/src/modules/tenders/__tests__/tender-delivery-days.parser.spec.ts`
- Modify: `tenders.mapper.ts` (add `tenderDeliveryDays`, `deliveryPeriodNeedsReview` to the DTO), tender detail page in `apps/web` (badge).

**Interfaces:**
- Produces: `parseDeliveryDaysFromNotes(notes: string | null | undefined): number | null` (weeks × 7, months × 30; if several periods are found, the smallest); DTO fields `tenderDeliveryDays: number | null` and `deliveryPeriodNeedsReview: boolean` (true when `tenderDeliveryDays !== null && tenderDeliveryDays < deliveryPeriodDays`), both computed on read from `Tender.notes`.

- [ ] **Step 1: Write failing tests:**
  - `"delivery within 45 days of PO" → 45`
  - `"Delivery period: 8 weeks" → 56`
  - `"to be delivered within 2 months from the date of order" → 60`
  - `"payment within 30 days of delivery" → null`
  - `null` and `""` → `null`
  - two periods (`"delivery within 60 days ... delivery within 30 days"`) → `30`
- [ ] **Step 2:** Run it, confirm FAIL.
- [ ] **Step 3:** Implement. Only match a number+unit that follows or precedes a delivery/deliver/supply/completion word within the same sentence; sentence-split on `.`/newline first.
- [ ] **Step 4:** Mapper test in `tenders.mapper` spec: `deliveryPeriodDays = 120` and notes "delivery within 90 days" gives `deliveryPeriodNeedsReview = true`; notes with no period gives `false`.
- [ ] **Step 5:** Show an amber "Check delivery period (tender asks N days)" badge on the tender detail header when the flag is true.
- [ ] **Step 6:** Run specs (PASS), typecheck; commit `feat(tenders): flag tender-stated delivery shorter than offered`.

### Task 4: Bid calculations

**Files:**
- Create: `apps/server/src/modules/portal-bid/bid-calculations.ts`
- Test: `apps/server/src/modules/portal-bid/__tests__/bid-calculations.spec.ts`

**Interfaces:**
- Produces:
  - `joinHsnCodes(items: ReadonlyArray<{ hsnCode: string | null }>): string | null`
  - `consignmentWeight(items: ReadonlyArray<{ quantity: number | null; unitWeightKg: number | null }>): { text: string | null; missing: number }`
  - `splitGst(gstRate: number, supplierGstin: string, billingGstin: string): { cgstPct: number; sgstPct: number; igstPct: number }`

- [ ] **Step 1: Write failing tests:**
  - `joinHsnCodes([{hsnCode:"4016"},{hsnCode:"4016"}])` → `"4016"`
  - `[{"4016"},{"7307"},{"4016"}]` → `"4016, 7307"`
  - `[{null},{""}]` → `null`
  - `consignmentWeight([{quantity:800,unitWeightKg:0.0625}])` → `{text:"50 Kg",missing:0}`
  - one item without weight → `{text:null,missing:1}`
  - `splitGst(18,"19ADIPC4887G1Z9","19AAACS7062F6Z6")` → `{9,9,0}`
  - `splitGst(18,"19…","27…")` → `{0,0,18}`
  - `splitGst(5,"19…","19…")` → `{2.5,2.5,0}`; `splitGst(0,…)` → all 0
- [ ] **Step 2:** Run, confirm FAIL. **Step 3:** Implement the three functions (pure, no I/O; format weight with trailing zeros trimmed). **Step 4:** Run, PASS. **Step 5:** Commit `feat(portal-bid): bid calculations`.

### Task 5: Question catalog

**Files:**
- Create: `apps/server/src/modules/portal-bid/portal-bid.types.ts`, `apps/server/src/modules/portal-bid/sail-isp.questions.ts`
- Test: `apps/server/src/modules/portal-bid/__tests__/sail-isp.questions.spec.ts`

**Interfaces:**
- Produces (in `portal-bid.types.ts`):
  - `type Widget = "text" | "combo" | "radio"`
  - `interface QuestionSpec { key: string; label: string; widget: Widget; source: "business" | "profile" | "tender" }` (`label` is the exact portal text, no trailing colon)
  - `interface ResolvedAnswer { key: string; label: string; widget: Widget; value: string; source: QuestionSpec["source"] }`
  - `interface ItemPriceRow { itemCode: string; description: string; quantity: number; rate: number; cgstPct: number; sgstPct: number; igstPct: number }`
  - `interface BidPayload { tenderNumber: string; answers: ResolvedAnswer[]; items: ItemPriceRow[]; expectedTotal: number; warnings: string[] }`
  - `SAIL_ISP_QUESTIONS: ReadonlyArray<QuestionSpec>` (in `sail-isp.questions.ts`) with every question in the capture, in page order. `source` is `"business"` for GSTIN, PAN, Udyam number, Email, Phone, Mobile, Address, Contact Person; `"tender"` for HSN code, Weight of the consignment, Delivery period; `"profile"` for everything else (the Yes/No declarations, "NA" fields, incoterms, dispatch mode and place, payment terms, technical deviation, validity answers, GeM vendor id, billing-party GSTIN and state, MSE status/caste).

- [ ] **Step 1: Write failing tests:** every `key` is unique; every `label` is unique; the catalog contains the exact labels `"Enter GSTIN/ ARN"`, `"Whether you accept the bid securing declaration as per the format avaialble in standard documents"`, `"Whether you accept the non collusive declarartion as per the format available in standard documents"`; HSN, weight and delivery period are the only `"tender"` entries.
- [ ] **Step 2:** Run, confirm FAIL. **Step 3:** Write the types and the catalog; take label text from the capture (`~/Downloads/mjunction-capture/srm.sailisp.co.in.har`, response index 90, label elements) and copy it exactly. **Step 4:** Run, PASS. **Step 5:** Commit `feat(portal-bid): SAIL ISP question catalog`.

### Task 6: Bid payload service

**Files:**
- Create: `apps/server/src/modules/portal-bid/bid-payload.service.ts`, `portal-bid.repository.ts`, `portal-bid.module.ts`
- Test: `apps/server/src/modules/portal-bid/__tests__/bid-payload.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 functions, Task 5 catalog and types; `ITendersRepository.findById`, `IBoqRepository.findCurrentBoq` and `findItemsByBoqId`, the businesses repository for GSTIN/address/contact.
- Produces:
  - `class BidPayloadService { constructor(deps: { tenders; boqs; businesses; portalProfiles: IPortalProfileRepository }); buildPayload(tenderId: string, businessId: string, portalCode: "SAIL_ISP"): Promise<BidPayload> }`
  - `interface IPortalProfileRepository { findAnswers(businessId: string, portalCode: string): Promise<Record<string, string>>; saveAnswers(businessId: string, portalCode: string, answers: Record<string, string>): Promise<void> }`
  - `interface IPortalBidRepository { upsertFromFill(input: { businessId; tenderId; portalCode; responseNumber; submissionDeadline: Date | null; totalValue: number | null; summary: unknown }): Promise<void>; findByResponseNumber(portalCode: string, responseNumber: string): Promise<{ tenderId: string; status: PortalBidStatus } | null> }`

- [ ] **Step 1: Write failing tests (fake repositories):**
  - Tender with 2 items (rate 17.75, qty 800, gst 18, HSN 4016, supplier and billing GSTIN state 19) gives one `ItemPriceRow` `{cgstPct:9,sgstPct:9,igstPct:0}` and `expectedTotal = 14200`
  - The HSN answer is `"4016"`; the delivery answer is `"120"`; business answers come from `Business` fields
  - A profile answer overridden by nothing is returned with `source:"profile"`
  - Items without HSN produce a warning and no HSN answer
  - A BOQ item with `rate = null` is excluded from `items` and listed in `warnings`
  - `deliveryPeriodNeedsReview` true adds a warning containing `"tender asks"`
- [ ] **Step 2:** Run, confirm FAIL. **Step 3:** Implement `buildPayload` (profile answers first, then business- and tender-derived values override by `key`). **Step 4:** Implement `portal-bid.repository.ts` (Prisma, businessId-scoped) and wire `portal-bid.module.ts` exporting the service singletons. **Step 5:** Run, PASS; commit `feat(portal-bid): build bid payload from tender data`.

### Task 7: PortalSession (page driver)

**Files:**
- Modify: `apps/server/package.json` (add `playwright-core` matching the workspace's Playwright version)
- Create: `apps/server/src/modules/portal-bid/portal/portal-session.ts`, `apps/server/src/modules/portal-bid/__tests__/fixtures/questions-page.html`, `conditions-grid.html`
- Test: `apps/server/src/modules/portal-bid/__tests__/portal-session.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  class PortalSession {
    static attach(cdpUrl: string): Promise<PortalSession>     // connectOverCDP, picks the tab on srm.sailisp.co.in
    constructor(page: Page)                                    // tests pass a fixture page
    readHeader(): Promise<{ responseNumber: string; rfxNumber: string; deadline: string | null; totalValue: string | null }>
    readField(label: string): Promise<string>                  // by label text; resolves the input via the label's `f` attribute
    writeField(label: string, value: string, widget: Widget): Promise<void>
    openTab(name: "Questions" | "Items" | "Conditions"): Promise<void>
    readConditionRows(): Promise<Array<{ itemCode: string; conditions: Record<string, string> }>>
    writeCondition(itemCode: string, conditionType: string, amount: string): Promise<void>
  }
  ```
  `writeField` rules: `text` and `combo` focus the input, select-all, `keyboard.type` with a per-key delay, press `Tab`, then wait for the network to be idle; `combo` additionally clicks the list entry whose text equals `value`, or throws `"value not offered: <value>"`; `radio` clicks the radio whose label text is `Yes` or `No` in that question's row. Nothing in this file may click a button named Save, Check or Submit (guarded by a test).

- [ ] **Step 1: Write failing tests** against fixture HTML saved from the capture (personal data replaced with placeholders), loaded with `page.setContent`: `readField("Enter GSTIN/ ARN")` returns the fixture value; `readField` throws `"label not found: <label>"` for an unknown label; `writeField` text then `readField` round-trips; `readHeader()` returns `responseNumber: "8100095724"`; `readConditionRows()` returns item `71802001600160` with `Price: "17.75"`; a source scan test asserts the file contains none of `"Save"`, `"Submit"`, `"Check"` as click targets.
- [ ] **Step 2:** `pnpm --filter @bmp/server add playwright-core`, `pnpm exec playwright-core install chromium`; run the spec, confirm FAIL. **Step 3:** Implement. **Step 4:** Run, PASS. **Step 5:** Commit `feat(portal-bid): label-based portal page driver`.

> The fixture cannot reproduce SAP's server events. Real-portal behavior is verified manually in Task 9.

### Task 8: fill-bid workflow, CLI, response-number lookup

**Files:**
- Create: `apps/server/src/modules/portal-bid/portal/fill-bid.ts`, `apps/server/src/scripts/portal-fill.ts`, `apps/server/src/scripts/portal-profile-import.ts`, `portal-bid.controller.ts`, `portal-bid.routes.ts`
- Modify: `apps/server/package.json` scripts, `apps/server/src/routes/v1.router.ts`
- Test: `apps/server/src/modules/portal-bid/__tests__/fill-bid.spec.ts`

**Interfaces:**
- Consumes: `PortalSession` (as an interface `IPortalSession` in `fill-bid.ts` so tests use an in-memory fake), `BidPayloadService.buildPayload`, `IPortalBidRepository`, `AuditService.log`.
- Produces: `fillBid(input: { session: IPortalSession; payload: BidPayload; tenderNumber: string; businessId: string; tenderId: string; dryRun: boolean; confirm: (warnings: string[]) => Promise<boolean> }): Promise<{ filled: number; skipped: string[]; mismatches: string[]; responseNumber: string }>`; routes `GET /portal-bids/by-response/:responseNumber` (`tenders:read`) returning `{ tenderId, tenderNumber, status }`; scripts `portal:fill` (`--tender <number> --business <code> [--dry-run] [--yes] [--cdp http://127.0.0.1:9222]`) and `portal:profile:import` (`--business <code>`; reads the open response's Questions page into `PortalProfile.answers`, keyed by catalog `key`).

- [ ] **Step 1: Write failing tests (fake session):**
  - RFx number ≠ tender number throws before any `writeField` call
  - `dryRun` makes zero `writeField` calls
  - Happy path: every answer and every item condition is written; read-back equal gives `mismatches = []`
  - Read-back differing (fake returns another value) adds the label to `mismatches`
  - A label the fake reports as not found goes to `skipped` and the run continues
  - Portal Total Value ≠ `expectedTotal` adds a mismatch containing `"Total Value"`
  - `confirm` returning false aborts with no writes
  - On success `PortalBid` is upserted with `responseNumber: "8100095724"` and an audit `TENDER_PORTAL_FILL_COMPLETED` is logged
- [ ] **Step 2:** Run, confirm FAIL. **Step 3:** Implement `fillBid` (order: header check, Questions, then per item Conditions Price/CGST/SGST/IGST, read-back, upsert, audit; CLI exits non-zero when `mismatches` or `skipped` is non-empty). **Step 4:** Implement the CLIs and route; add `"portal:fill"` and `"portal:profile:import"` scripts running via `tsx`. **Step 5:** Run, PASS; `pnpm typecheck && pnpm lint`; commit `feat(portal-bid): fill-bid workflow and CLI`.

### Task 9: Live verification (manual)

- [ ] **Step 1:** Start Chrome: `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=$HOME/.bmp-portal-chrome`; log in, open response 8100095724 (Edit).
- [ ] **Step 2:** `pnpm --filter @bmp/server portal:profile:import --business SAMSON`, then inspect `PortalProfile.answers`.
- [ ] **Step 3:** `pnpm --filter @bmp/server portal:fill --tender 1400014359 --business SAMSON --dry-run`: check the printed answer set against the screenshots, in particular the HSN, weight, delivery and the 9% + 9% GST split.
- [ ] **Step 4:** Run without `--dry-run` on the saved response, confirm zero mismatches and `Total Value 14,200.00`, review on the portal, and Save it yourself.
- [ ] **Step 5:** `GET /api/v1/portal-bids/by-response/8100095724` returns tender 1400014359.
- [ ] **Step 6:** Run `pnpm typecheck && pnpm lint && pnpm test`; fix any failures. Run `graphify update .`.
