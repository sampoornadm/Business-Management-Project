# Rate Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selected RFQ quotes become per-item base rates on the tender (with a 15% default markup), tender rates are locked before submission, and both vendor rates (on RFQ finalize) and the owner's rates (on tender submit) are recorded per inventory item.

**Architecture:** One Prisma migration adds the new columns. RFQ "Finalize rates" replaces Close + Push-rates-to-tender in `RfqService`. Base-rate/markup math lives in one pure helper (`boq-pricing.ts`) used by both `BoqService` and `RfqService`. Tender lock + submit gate + own-rate recording live in `TendersService`. `HistoricalRate` gains `kind` (VENDOR/OWN) and `itemId`, and every AI-matching read filters to VENDOR.

**Tech Stack:** Express + Prisma + PostgreSQL (server), Next.js 15 + TanStack Query + shadcn (web), Vitest (fake repositories for unit tests, supertest for integration).

**Spec:** `docs/superpowers/specs/2026-11-11-rate-finalization-design.md`

## Global Constraints

- Default markup: **15%**. `rate = round2(baseRate × (1 + markupPercent/100))`. Use `round2` from `apps/server/src/shared/utils/math.ts`.
- Rates lock toggle only works while tender status is `DRAFT`. Any transition **to** `SUBMITTED` requires `ratesLockedAt != null`.
- Own rates are written on transition to `SUBMITTED`, never on lock. One OWN row per (tender, item): resubmit replaces that tender's rows.
- RFQ finalize records **every** priced, non-regretted quote (one VENDOR row per quote, upsert by `rfqQuoteId`). Only the selected quote's row has `isDefault = true`.
- AI rate matching (`findNearest`, `suggest`) must read `kind = 'VENDOR'` rows only — no behaviour change for existing data.
- Nothing is deleted on a schedule. The item page shows the last 5 years by default, with "Show all".
- No new RBAC keys: lock/unlock uses `boq:update`, RFQ finalize uses `rfq:update`.
- Repo conventions from `CLAUDE.md` apply: repository interface + class, thin controller, zod validation, `AuditService.log` for events, fakes not mocks, `pnpm db:migrate:create` (never plain `prisma migrate dev` — pgvector drift prompt).
- Unit test command: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run <path>`.

## Review Focus

1. **Base rate of 0** (vendor quoted 0 or typo): `markupFromRate` must not divide by zero — keep the existing markup, rate as typed. Test in Task 4.
2. **Selected quote later regretted** by the same vendor: auto-pick must move off it (if automatic), and finalize must skip a selected-but-regretted quote and count it as skipped. Tests in Tasks 2 and 5.
3. **Undo a result (WON/LOST → SUBMITTED):** must not demand a new reference number (it keeps the stored one) and must not fail the lock gate (it is still locked). Test in Task 6.
4. **Submitting a tender with no current BOQ / no priced items:** allowed once locked, records zero own rates, no crash. Test in Task 6.
5. **RFQ finalize while the tender is locked:** vendor rates still recorded, tender untouched, response says `tenderLocked: true`. Test in Task 5.

---

### Task 1: Schema migration + shared types

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_rate_finalization/migration.sql` (via `pnpm db:migrate:create --name rate_finalization`, then edited)
- Modify: `packages/types/src/boq.ts`, `packages/types/src/tender.ts`, `packages/types/src/item.ts`, `packages/types/src/rfq.ts`

**Interfaces:**
- Produces (Prisma):
  - `RfqItem.selectionManual Boolean @default(false)`
  - `BoqItem.baseRate Float?`, `BoqItem.markupPercent Float?`, `BoqItem.baseRateQuoteId String?` + relation `baseRateQuote RfqQuote? @relation(fields: [baseRateQuoteId], references: [id], onDelete: SetNull)` (back-relation `baseRateFor BoqItem[]` on `RfqQuote`)
  - `Tender.ratesLockedAt DateTime?`, `Tender.ratesLockedById String?` + relation to `User` (`onDelete: SetNull`), `Tender.submissionReference String?`
  - `enum HistoricalRateKind { VENDOR OWN }`; `HistoricalRate.kind HistoricalRateKind @default(VENDOR)`, `HistoricalRate.itemId String?` + relation `item Item? @relation(onDelete: SetNull)`, `HistoricalRate.baseRate Float?`, `HistoricalRate.markupPercent Float?`, `@@index([itemId, kind])`, `@@index([sourceTenderId, kind])`
- Produces (types):
  - `BoqItemDto` += `baseRate: number | null; markupPercent: number | null; baseRateSource: { quoteId: string; rfqId: string; vendorId: string; vendorName: string; make: string; model: string; quotedAt: string } | null`
  - `TenderDto` += `ratesLockedAt: string | null; ratesLockedByName: string | null; submissionReference: string | null`
  - `ItemDetailDto`: remove `entries`; add `vendorRates: ItemVendorRateDto[]; ownRates: ItemOwnRateDto[]`
  - `ItemVendorRateDto { id; rate: number; effectiveDate: string; vendorId: string | null; vendorName: string | null; rfqId: string | null; make: string | null; model: string | null; isDefault: boolean }`
  - `ItemOwnRateDto { id; rate: number; baseRate: number | null; markupPercent: number | null; effectiveDate: string; tenderId: string | null; tenderNumber: string | null }`
  - `FinalizeRfqRatesResultDto { vendorRatesRecorded: number; tenderItemsUpdated: number; tenderItemsSkipped: number; tenderLocked: boolean }` (in `rfq.ts`)
  - `DEFAULT_MARKUP_PERCENT = 15` exported from `packages/types/src/boq.ts`

- [ ] **Step 1: Edit `schema.prisma`** with the fields above. Do not touch the `Unsupported("vector(1024)")` column or its indexes.
- [ ] **Step 2: Create the migration** with `pnpm db:migrate:create --name rate_finalization`. If Prisma offers a "corrective" migration touching `*_hnsw_idx`, decline.
- [ ] **Step 3: Append data backfill SQL** to the generated `migration.sql`:

```sql
-- Existing non-draft tenders count as already locked, so "Submitted ⇒ locked" holds for old data.
UPDATE "tenders" SET "ratesLockedAt" = "statusChangedAt" WHERE "status" <> 'DRAFT';

-- A selection a human made has an RFQ_QUOTE_SELECTED audit row naming that item.
UPDATE "rfq_items" ri SET "selectionManual" = true
WHERE EXISTS (
  SELECT 1 FROM "audit_logs" a
  WHERE a."action" = 'RFQ_QUOTE_SELECTED' AND a."metadata"->>'rfqItemId' = ri."id"
);

-- Re-run the auto-pick for every automatic item: lowest priced non-regretted quote wins.
UPDATE "rfq_quotes" q SET "isSelected" = false
FROM "rfq_items" ri WHERE q."rfqItemId" = ri."id" AND ri."selectionManual" = false;
UPDATE "rfq_quotes" q SET "isSelected" = true
FROM (
  SELECT DISTINCT ON (q2."rfqItemId") q2."id"
  FROM "rfq_quotes" q2 JOIN "rfq_items" ri ON ri."id" = q2."rfqItemId"
  WHERE ri."selectionManual" = false AND q2."regretted" = false AND q2."rate" IS NOT NULL
  ORDER BY q2."rfqItemId", q2."rate" ASC, q2."quotedAt" ASC
) lowest WHERE q."id" = lowest."id";
```

- [ ] **Step 4: Apply and regenerate.** Run `pnpm db:migrate`, then `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/database exec prisma migrate deploy`, then `pnpm db:generate`. Expected: both DBs report the migration applied; `SHOW hnsw.iterative_scan;` is unchanged.
- [ ] **Step 5: Add the DTO fields/types** listed above. Map the new nullable fields in `boq.mapper.ts` and `tenders.mapper.ts` (null when absent). Leave `ItemDetailDto` consumers broken for now. Task 7 fixes them, so typecheck only `@bmp/types` here.
- [ ] **Step 6: Run** `pnpm --filter @bmp/types typecheck`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(db): rate finalization schema (base rate, markup, rates lock, rate kinds)`.

---

### Task 2: Per-item lowest-quote auto-selection

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.repository.ts`, `apps/server/src/modules/rfq/rfq.service.ts`
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Produces: `IRfqRepository.selectQuote(rfqItemId: string, quoteId: string | null, manual: boolean): Promise<void>`. `null` clears every selection on the item. Sets `RfqItem.selectionManual = manual` in the same transaction.
- `RfqDetail` items include `selectionManual`.
- Private `RfqService.autoSelectLowest(rfqItemId: string, businessId: string): Promise<void>`. No-op if `selectionManual`. Otherwise selects the lowest priced, non-regretted quote (tie → earliest `quotedAt`), or clears selection if none.

- [ ] **Step 1: Write failing tests** in `rfq.service.spec.ts` (update the fake repository for the new `selectQuote` signature):
  - `auto-selects a later cheaper quote`: vendor A 100, then vendor B 90 → B selected.
  - `moves auto-selection off a quote that becomes regretted`: A 90 selected, A regrets → B (100) selected.
  - `clears auto-selection when no priced quote remains`.
  - `never overrides a manual pick`: `selectQuote` on A (120), then B 90 arrives → A still selected.
  - `importQuotes auto-selects lowest per item`.
- [ ] **Step 2: Run** the spec. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `upsertQuote` (replacing the "only while nothing has been selected" block) and after each row in `importQuotes`, call `autoSelectLowest`. In `selectQuote`, call the repository with `manual = true`.
- [ ] **Step 4: Run** the spec. Expected: PASS (including existing tests).
- [ ] **Step 5: Commit** `fix(rfq): auto-select lowest quote per item until a human picks one`.

---

### Task 3: Historical rates: kinds, vendor/own recording, AI filter

**Files:**
- Modify: `apps/server/src/modules/rates/rates.repository.ts`
- Test: `apps/server/src/modules/rates/__tests__/rates.repository.integration.spec.ts`

**Interfaces:**
- Produces:
  - `recordVendorRates(rfqId: string, rows: VendorRateRow[]): Promise<number>`, where `VendorRateRow = { businessId; itemId: string; itemName: string; unit: string; rate: number; vendorId: string; rfqQuoteId: string; sourceTenderId: string | null; quotedAt: Date; isDefault: boolean; createdById: string }`. In one transaction:
    1. Delete VENDOR rows whose `rfqQuote.rfqItem.rfqId = rfqId` and whose `rfqQuoteId` is not in `rows`. This removes rows for quotes regretted since the last finalize.
    2. For each `isDefault` row, clear `isDefault` on other VENDOR rows with the same `(businessId, itemId)`.
    3. Upsert each row by `rfqQuoteId`, using `effectiveDate = quotedAt`.
    Returns the row count.
  - `replaceOwnRates(tenderId: string, rows: OwnRateRow[]): Promise<void>`, where `OwnRateRow = { businessId; itemId: string; itemName: string; unit: string; rate: number; baseRate: number | null; markupPercent: number | null; createdById: string }`. In one transaction: `deleteMany({ kind: OWN, sourceTenderId: tenderId })`, then `createMany` with `kind: OWN`, `sourceTenderId: tenderId`, `effectiveDate: now`, `category: MATERIAL`.
  - `findByItem(itemId: string, businessId: string): Promise<ItemRateRow[]>`: both kinds, newest `effectiveDate` first, including vendor name, the quote's make/model/rfqId, and the tender's `tenderNumber` (looked up via `sourceTenderId`).
  - Remove `recordFromRfqQuote` (its only caller is removed in Task 5).
  - `findNearest` SQL and `suggest` add `kind = 'VENDOR'`.

- [ ] **Step 1: Write failing integration tests:**
  - `recordVendorRates writes one row per quote and marks only the selected default`.
  - `recordVendorRates re-run drops a quote no longer in rows`.
  - `replaceOwnRates replaces a tender's rows, leaves other tenders' rows`.
  - `findNearest ignores OWN rows`: insert an OWN row with an embedding identical to the query and assert it is not returned.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the methods above. Update fakes of `IHistoricalRatesRepository` in other spec files (`boq*.spec.ts`, `rfq.service.spec.ts`) so they compile.
- [ ] **Step 4: Run** this spec plus `rates-ann.integration.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rates): vendor/own rate kinds, per-RFQ and per-tender recording`.

---

### Task 4: BOQ base rate, markup, and rates-lock enforcement

**Files:**
- Create: `apps/server/src/modules/boq/boq-pricing.ts`
- Modify: `apps/server/src/modules/boq/boq.service.ts`, `boq.repository.ts`, `boq.validation.ts`, `boq.mapper.ts`
- Test: `apps/server/src/modules/boq/__tests__/boq-pricing.spec.ts` (create), `boq.service.spec.ts`

**Interfaces:**
- Produces (`boq-pricing.ts`):
  - `rateFromMarkup(baseRate: number, markupPercent: number): number`, which is `round2(base × (1 + m/100))`.
  - `markupFromRate(baseRate: number, rate: number, fallback: number | null): number | null`, which is `round2((rate/base − 1) × 100)`, or `fallback` when `baseRate === 0`.
- Produces (`IBoqRepository`): `setBaseRate(id: string, data: { baseRate: number; baseRateQuoteId: string; markupPercent: number; rate: number; amount: number | null }): Promise<void>`. `findItemsByIds` / `findItemsByBoqId` include `baseRateQuote` with vendor and `rfqItem.rfqId`.
- Produces (`BoqService`): private `assertRatesUnlocked(tenderId: string, businessId: string): Promise<void>`, which throws `ConflictError("Tender rates are finalized — unlock them to edit")` when `tender.ratesLockedAt` is set.
- `updateBoqItemSchema` += `markupPercent: z.number().min(-100).max(1000).optional()`.
- `bulkUpdateBoqItemsSchema`: replace `ratePercentAdjustment` with `markupPercent: z.number().min(-100).max(1000)`.

- [ ] **Step 1: Write failing tests.**
  - `boq-pricing.spec.ts`:
    - `rateFromMarkup(100, 15) === 115`
    - `rateFromMarkup(33.33, 15) === 38.33`
    - `markupFromRate(100, 120, 15) === 20`
    - `markupFromRate(0, 50, 15) === 15`
    - `markupFromRate(0, 50, null) === null`
  - `boq.service.spec.ts`:
    - `updateItem with markupPercent recomputes rate and amount from baseRate`: base 200, qty 3, markup 10 → rate 220, amount 660.
    - `updateItem with rate on a based item recomputes markup`.
    - `updateItem on an item without baseRate ignores markup math` (rate as typed, markup stays null).
    - `bulk markup sets markup on based items, skips others`.
    - Each of `updateItem`, `addItem`, `deleteItem`, `bulkUpdateItems`, `upsertRateAnalysis`, and `commitBoq` with `replacesBoqId`: `throws ConflictError when tender rates are locked`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `assertRatesUnlocked` at the top of each mutation listed above. Resolve `tenderId` via the item's BOQ.
  - Rate/markup interplay: if `data.markupPercent` is given and `baseRate != null`, rate = `rateFromMarkup`. Otherwise, if `data.rate` is given and `baseRate != null`, markup = `markupFromRate(base, rate, existing.markupPercent)`.
  - `upsertRateAnalysis` recomputes markup the same way when the item has a base rate.
  - `bulkUpdateItems` returns the BOQ DTO with an added `skipped: number`. Add `skipped?: number` to the response type in `packages/types/src/boq.ts`.
  - Mapper fills `baseRate`, `markupPercent`, `baseRateSource`.
- [ ] **Step 4: Run** both specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat(boq): base rate + markup pricing and rates-lock enforcement`.

---

### Task 5: RFQ "Finalize rates"

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts`, `rfq.controller.ts`, `rfq.routes.ts`, `rfq.module.ts`
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Consumes: `IHistoricalRatesRepository.recordVendorRates` (Task 3), `IBoqRepository.setBaseRate` + `rateFromMarkup` + `DEFAULT_MARKUP_PERCENT` (Task 4), `IItemsRepository.findOrCreateItem` and `deriveCanonicalName(null, description)` (existing).
- Produces: `RfqService.finalizeRates(rfqId: string, actorId: string, businessId: string): Promise<FinalizeRfqRatesResultDto>`, at route `POST /rfqs/:id/finalize-rates` (`rfq:update`).
- Removes: `RfqService.close`, `RfqService.pushRatesToTender`, routes `/:id/close` and `/:id/push-rates-to-tender`, and their controller handlers and OpenAPI docs. `reopen` stays as the unlock.
- `RfqService` constructor gains `itemsRepository: IItemsRepository` as the last parameter. Wire it in `rfq.module.ts` with `new ItemsRepository(prisma)`, as `boq.module.ts` does.

Behaviour of `finalizeRates`:
1. 409 if already CLOSED/CANCELLED.
2. Set status CLOSED.
3. For each item, resolve `itemId` (use `RfqItem.itemId`, else find-or-create by canonical name and link it via `itemsRepository.linkRfqItems`).
4. `recordVendorRates` with every priced, non-regretted quote, `isDefault = quote.isSelected`.
5. If `rfq.tenderId` is set:
   - If that tender's `ratesLockedAt` is set, skip the tender writes and set `tenderLocked: true`.
   - Otherwise, for each item whose selected quote is priced and non-regretted, and whose `boqItemId` resolves to an item of the tender's **current** BOQ: call `setBaseRate` with markup = existing `markupPercent ?? DEFAULT_MARKUP_PERCENT`. Count everything else as skipped.
6. Audit log `RFQ_RATES_FINALIZED` with the result as metadata.

- [ ] **Step 1: Write failing tests:**
  - `finalizeRates closes the RFQ and records every priced quote`: 2 items × 2 vendors with one regret → 3 rows, `vendorRatesRecorded: 3`.
  - `sets base rate with 15% default markup on current-BOQ items`: selected 100 → baseRate 100, markup 15, rate 115.
  - `keeps an item's existing markup on re-finalize`.
  - `skips selected-but-regretted, unselected, and non-current-BOQ items and counts them`.
  - `skips tender writes when tender rates are locked but still records vendor rates`.
  - `RFQ without a tender records vendor rates only`.
  - `rejects finalizing an already-closed RFQ`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** as described above. Delete the removed methods and their now-dead tests.
- [ ] **Step 4: Run** `rfq.service.spec.ts` and `rfq-quotes.integration.spec.ts`. Expected: PASS. Fix any integration test that called `/close` so it uses `/finalize-rates`.
- [ ] **Step 5: Commit** `feat(rfq): finalize rates — record vendor rates, set tender base rates`.

---

### Task 6: Tender rates lock, submit gate, reference number, own rates

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`, `tenders.repository.ts`, `tenders.validation.ts`, `tenders.controller.ts`, `tenders.routes.ts`, `tenders.module.ts`, `tenders.mapper.ts`
- Test: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`, `tenders.integration.spec.ts`

**Interfaces:**
- Consumes: `IHistoricalRatesRepository.replaceOwnRates` (Task 3), `IBoqRepository.findCurrentBoq` / `findItemsByBoqId`, `IItemsRepository.findOrCreateItem`, `deriveCanonicalName`.
- Produces:
  - `TendersService.setRatesLock(id: string, locked: boolean, actorId: string, context: ScopedRequestContext): Promise<TenderDto>`, at route `PUT /tenders/:id/rates-lock`, body `{ locked: boolean }`, permission `boq:update`. 409 `"Rates can only be locked or unlocked while the tender is a draft"` unless status is DRAFT. Audit `TENDER_RATES_LOCKED` / `TENDER_RATES_UNLOCKED`.
  - `changeTenderStatusSchema` += `submissionReference: z.string().trim().min(1).max(200).optional()`.
  - `ITendersRepository.updateStatus` data += `submissionReference?: string`. `setRatesLock(id, data: { ratesLockedAt: Date | null; ratesLockedById: string | null })`.
  - `TendersService` constructor gains `boqRepository: IBoqRepository, itemsRepository: IItemsRepository, ratesRepository: IHistoricalRatesRepository`, appended after `hasPermission`. Wire them with fresh `new ...Repository(prisma)` in `tenders.module.ts`.

Rules in `changeStatus` when `input.status === "SUBMITTED"`:
- 400 `"Finalize the tender's rates before submitting"` if `ratesLockedAt` is null.
- If `previousStatus` is DRAFT or CANCELLED and `kind === "TENDER"`, `submissionReference` is required (400 `"Submission reference number is required"`). From WON/LOST it is optional and the stored value is kept when omitted.
- Before `updateStatus`, write own rates: current-BOQ items with `rate != null` → `replaceOwnRates`. This runs before the status write on purpose: it is an idempotent replace, so a failed status write leaves only rows the retry will overwrite.
- Add `submissionReference` to the `TENDER_STATUS_CHANGED` metadata.

- [ ] **Step 1: Write failing unit tests:**
  - `refuses SUBMITTED when rates are not locked`.
  - `requires a reference when submitting a TENDER from DRAFT`.
  - `BUDGETARY submits without a reference`.
  - `WON → SUBMITTED keeps the stored reference and needs none`.
  - `submit writes own rates for priced current-BOQ items only, with base rate and markup`.
  - `submit with no current BOQ succeeds and writes no own rates`.
  - `setRatesLock refuses outside DRAFT`.
  - `reverting SUBMITTED → DRAFT leaves rates locked`.
- [ ] **Step 2: Write a failing integration test** in `tenders.integration.spec.ts`: `lock → submit gating` round-trip over HTTP (submit 400 → `PUT rates-lock` → submit with reference 200 → `GET` shows `submissionReference` and `ratesLockedAt`).
- [ ] **Step 3: Run** both. Expected: FAIL.
- [ ] **Step 4: Implement** as described above.
- [ ] **Step 5: Run** both specs. Expected: PASS. If they 429, `docker compose exec redis redis-cli FLUSHALL` and re-run.
- [ ] **Step 6: Commit** `feat(tenders): rates lock, submit gate with reference number, record own rates`.

---

### Task 7: Item detail: vendor and own rate history (server)

**Files:**
- Modify: `apps/server/src/modules/items/items.service.ts`, `items.mapper.ts`, `items.module.ts`
- Test: `apps/server/src/modules/items/__tests__/items.service.spec.ts`

**Interfaces:**
- Consumes: `IHistoricalRatesRepository.findByItem` (Task 3).
- Produces: `getItemDetail` returns `vendorRates` (kind VENDOR) and `ownRates` (kind OWN), each newest first, in place of `entries`. `ItemsService` gains `ratesRepository` as its last constructor parameter. The list page's aggregates (`quoteCount`, `minRate`, …) are unchanged.

- [ ] **Step 1: Write a failing test** `getItemDetail splits vendor and own rates newest first`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Drop the `listItemPrices` call from `getItemDetail` only.
- [ ] **Step 4: Run.** Expected: PASS. Then run `pnpm --filter @bmp/server typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(items): vendor and own rate history on item detail`.

---

### Task 8: Web: RFQ finalize + item detail rate history

**Files:**
- Modify: `apps/web/src/hooks/use-rfq.ts`, `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`, `apps/web/src/hooks/use-items.ts` (if it types the detail), `apps/web/src/app/(dashboard)/items/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST /rfqs/:id/finalize-rates` → `FinalizeRfqRatesResultDto`; `ItemDetailDto.vendorRates/ownRates`.
- Produces: `useFinalizeRfqRates(rfqId)`, which replaces `useCloseRfq` and `usePushRatesToTender` (delete both).

- [ ] **Step 1: RFQ page.** Replace the "Close RFQ" and "Push rates to tender" buttons with one **Finalize rates** button, shown when status is not CLOSED/CANCELLED, behind a confirm dialog. The toast reports `vendorRatesRecorded`, `tenderItemsUpdated` and `tenderItemsSkipped`. When `tenderLocked`, show: "Tender rates are locked — unlock them on the tender and finalize again to update base rates."
- [ ] **Step 2: Item detail page.** Replace the entries table with two sections: "Vendor rates" (vendor, rate, make/model, date, RFQ link, a "Selected" badge when `isDefault`) and "My rates" (tender number linking to `/tenders/:id`, rate, base rate, markup %, date). Each section filters client-side to `effectiveDate >= now − 5 years`, with a "Show all (N)" toggle when older rows exist.
- [ ] **Step 3: Run** `pnpm --filter @bmp/web typecheck` and `pnpm --filter @bmp/web lint` (dev server stopped, per `CLAUDE.md`). Expected: PASS.
- [ ] **Step 4: Commit** `feat(web): RFQ finalize rates button, item rate history sections`.

---

### Task 9: Web: tender items base rate/markup, lock switch, submit dialog

**Files:**
- Modify: `apps/web/src/components/boq/boq-item-grid.tsx`, `apps/web/src/hooks/use-boq.ts`, `apps/web/src/hooks/use-tenders.ts`, `apps/web/src/components/tenders/tender-items-tab.tsx`, `apps/web/src/components/tenders/tender-status-tracker.tsx`

**Interfaces:**
- Consumes: `BoqItemDto.baseRate/markupPercent/baseRateSource`, `PUT /tenders/:id/rates-lock`, `changeTenderStatusSchema.submissionReference`, the bulk `markupPercent` body.
- Produces: `useSetTenderRatesLock(tenderId)`.

- [ ] **Step 1: Grid columns.** Add **Base rate** before Rate. The cell shows the value plus a muted line with the vendor name; a tooltip shows make/model/quote date with a link to the RFQ. Add an inline-editable **Markup %** column, editable only when `baseRate != null`. Replace the bulk "% adjustment" input with **Set markup %**; the toast names the skipped count.
- [ ] **Step 2: Lock switch.** On the Items tab header, add a shadcn `Switch` with a `Lock`/`LockOpen` icon labelled "Rates finalized". It is disabled with the tooltip "Move the tender back to Draft to unlock" when status ≠ DRAFT. While locked, every rate/markup/quantity cell, the add/delete item actions, bulk markup, rate analysis and BOQ upload are read-only/disabled. Gate on `hasPermission(role, "boq:update")`.
- [ ] **Step 3: Submit dialog.** The "Mark Submitted" stage in `tender-status-tracker.tsx`:
  - If `ratesLockedAt` is null, show a disabled hint "Finalize rates on the Items tab first" instead of calling the API.
  - Otherwise, from DRAFT or CANCELLED, open a dialog with a required "Submission reference number" input, prefilled from `tender.submissionReference`. It is optional for `kind === "BUDGETARY"`.
  - WON/LOST → SUBMITTED keeps today's flow (no dialog).
- [ ] **Step 4: Run** `pnpm --filter @bmp/web typecheck` and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): base rate + markup columns, rates lock switch, submit reference dialog`.

---

### Task 10: Whole-branch verification

- [ ] **Step 1:** `pnpm lint`, then `pnpm build`, then `pnpm typecheck` (sequentially). Expected: all PASS.
- [ ] **Step 2:** `pnpm test`. Expected: PASS, apart from failures already present on `main`. Record those before starting (run `pnpm test` on `main` first) and list them.
- [ ] **Step 3:** `graphify update .`
- [ ] **Step 4: Commit** any graph/lint fixes: `chore: graph update for rate finalization`.
