# Submission History & Change Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every fresh tender submission is stored as a numbered snapshot with a readable "what changed since the previous submission" summary. The summary shows on the tender History tab and in an Audit Log that now displays each event's readable entity code. Vendor quote remarks become normalised technical deviations, shown on the tender line priced from that quote.

**Architecture:**
- `TendersService.changeStatus` builds a snapshot of the current BOQ's leaf lines and diffs it against the tender's latest `TenderSubmission` with a pure `submission-diff.ts` module. It stores the result (lines, changes, rendered summary) and puts `submissionNumber` + `summary` into the existing `TENDER_STATUS_CHANGED` audit metadata.
- `AuditService.log` resolves a readable `entityCode` per row through an injected resolver that uses the unscoped base Prisma client.
- `RfqQuote.remarks` is renamed in code to `technicalDeviation` (`@map("remarks")`) and normalised on every write.

**Tech Stack:** Express + Prisma + PostgreSQL, Next.js 15 + TanStack Query + shadcn, Vitest (fakes for unit tests, supertest for integration).

**Spec:** `docs/superpowers/specs/2026-11-12-submission-history-design.md`

## Global Constraints

- A **fresh submission** is a move to `SUBMITTED` from `DRAFT`, or from `CANCELLED` when the tender has no `TenderSubmission` yet. Anything else that reaches `SUBMITTED` (WON/LOST → SUBMITTED, undoing a cancel) records **only** the `TENDER_STATUS_CHANGED` audit row: no snapshot, no `recordOwnRates`, no reference requirement.
- The comparison is always with the tender's latest previous submission only. Stored submissions are never updated or deleted by app code.
- Snapshots contain **leaf** BOQ lines only (lines that no other line names as `parentId`).
- Lines are matched between snapshots by `boqItemId`. Lines still unmatched are then matched by exact `description` + `unit`. The rest are added/removed.
- "No deviation" phrases are matched against the **whole** trimmed text, case-insensitive, ignoring surrounding punctuation/whitespace: `no`, `na`, `n/a`, `n.a.`, `nil`, `nill`, `none`, `-`, `--`, `not applicable`, `nd`, `no deviation`, `no deviations`, `no deviation from spec`, `no deviation from specs`, `no deviation from specification`, `no deviation from specifications`. Empty → null. Never drop text that merely starts with "No".
- Display label everywhere: **Technical deviation (if any)** (sheet header, RFR PDF/Word header). In-app label: "Technical deviation".
- `TenderSubmission` joins `SCOPED_MODELS` in `apps/server/src/infra/prisma/scoped-client.ts`. Every read filters by `businessId`.
- Entity-code resolution must never make `AuditService.log` throw: on any error, store null.
- Migrations: `pnpm db:migrate:create --name <name>`, then hand-edit. **Delete any generated `DROP INDEX "*_embeddingVector_hnsw_idx"` lines.** Apply to dev (`pnpm db:migrate`) and test (`pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/database exec prisma migrate deploy`), then `pnpm db:generate`.
- Unit tests: `cd apps/server && pnpm exec dotenv -e ../../.env.test -- pnpm exec vitest run <path>`. Before integration tests, run `docker compose exec redis redis-cli FLUSHALL` (login rate limiter).

## Review Focus

1. **Tender submitted before this ships** (status SUBMITTED, no `TenderSubmission`), reverted to DRAFT and resubmitted: becomes #1 with the first-submission summary. No crash on the missing previous. Test in Task 4.
2. **Re-uploaded BOQ version between submissions** (all new `boqItemId`s, same descriptions): only real differences are reported, not every line added + removed. Test in Task 3.
3. **Two lines with identical description + unit** in one snapshot: fallback matching pairs them one-to-one in order, never two-to-one. Test in Task 3.
4. **Budgetary tender** (no reference): the summary header omits the "ref" segment, with no "ref null". Test in Task 3.
5. **Deviation text "No ISI mark on supplied make"** survives normalisation. Test in Task 2.

---

### Task 1: Schema, migration, shared types

**Files:**
- Modify: `packages/database/prisma/schema.prisma`, `apps/server/src/infra/prisma/scoped-client.ts`
- Create: `packages/database/prisma/migrations/<ts>_submission_history/migration.sql`
- Modify: `packages/types/src/tender.ts`, `packages/types/src/audit.ts`, `packages/types/src/rfq.ts`, `packages/types/src/boq.ts`

**Interfaces — Produces:**
- Prisma model `TenderSubmission` (`@@map("tender_submissions")`):
  - fields: `id`, `businessId` (→ Business, Restrict), `tenderId` (→ Tender, Cascade), `number Int`, `submissionReference String?`, `totalAmount Float`, `lines Json`, `changes Json?`, `summary String`, `submittedById String?` (→ User, SetNull), `submittedAt DateTime @default(now())`
  - indexes: `@@unique([tenderId, number])`, `@@index([businessId])`
  - back-relations on Business, Tender (`submissions`), User (`"TenderSubmittedBy"`)
- `AuditLog.entityCode String?` + `@@index([entityCode])`.
- `RfqQuote.technicalDeviation String? @map("remarks")` (replaces `remarks`).
- `@bmp/types` (tender.ts):
  - `TenderSubmissionLineDto { boqItemId: string; description: string; unit: string | null; quantity: number | null; rate: number | null; amount: number | null; baseRate: number | null; markupPercent: number | null; vendorId: string | null; vendorName: string | null; hsnCode: string | null; technicalDeviation: string | null }`
  - `SubmissionLineField = "rate" | "baseRate" | "markupPercent" | "vendor" | "quantity" | "hsnCode" | "technicalDeviation"`
  - `SubmissionLineDiff { before: TenderSubmissionLineDto; after: TenderSubmissionLineDto; changed: SubmissionLineField[] }`
  - `SubmissionChanges { reference: { before: string | null; after: string | null } | null; total: { before: number; after: number } | null; lines: SubmissionLineDiff[]; added: TenderSubmissionLineDto[]; removed: TenderSubmissionLineDto[] }`
  - `TenderStatusHistoryEntryDto` += `submission: { number: number; reference: string | null; summary: string } | null`
- `AuditLogDto` += `entityCode: string | null`. `AUDIT_LOG_FILTER_FIELDS` += `"entityCode"`. `AUDIT_LOG_SORT_FIELDS` += `"entityCode"`.
- `RfqQuoteDto.remarks`, `UpsertRfqQuoteInput.remarks` and `ItemPriceHistoryDto.remarks` are renamed to `technicalDeviation`.
- `BoqBaseRateSourceDto` += `technicalDeviation: string | null`.

- [ ] **Step 1: Edit `schema.prisma`** as above. Run `pnpm exec dotenv -e .env -- pnpm --filter @bmp/database exec prisma validate`. Expected: "valid".
- [ ] **Step 2: Create the migration** (`pnpm db:migrate:create --name submission_history`). Delete any HNSW `DROP INDEX` lines. Confirm Prisma emitted **no** DROP/ADD for `rfq_quotes.remarks` (the `@map` keeps the column).
- [ ] **Step 3: Append backfills** to `migration.sql`:

```sql
-- Readable entity codes for existing audit rows (same mapping as AuditService's resolver).
UPDATE "audit_logs" a SET "entityCode" = t."tenderNumber" FROM "tenders" t
  WHERE a."entityType" = 'Tender' AND a."entityId" = t."id";
UPDATE "audit_logs" a SET "entityCode" = t."tenderNumber"
  FROM "boq_items" bi JOIN "boqs" b ON b."id" = bi."boqId" JOIN "tenders" t ON t."id" = b."tenderId"
  WHERE a."entityType" = 'BoqItem' AND a."entityId" = bi."id";
UPDATE "audit_logs" a SET "entityCode" = CASE WHEN i."itemCode" ~ '^\d{11}$'
    THEN substr(i."itemCode",1,2)||' '||substr(i."itemCode",3,2)||' '||substr(i."itemCode",5,4)||' '||substr(i."itemCode",9,3)
    ELSE COALESCE(i."itemCode", i."canonicalName") END
  FROM "items" i WHERE a."entityType" = 'Item' AND a."entityId" = i."id";
UPDATE "audit_logs" a SET "entityCode" = r."title" FROM "rfqs" r WHERE a."entityType" = 'Rfq' AND a."entityId" = r."id";
UPDATE "audit_logs" a SET "entityCode" = p."poNumber" FROM "purchase_orders" p WHERE a."entityType" = 'PurchaseOrder' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "entityCode" = b."billNumber" FROM "bills" b WHERE a."entityType" = 'Bill' AND a."entityId" = b."id";
UPDATE "audit_logs" a SET "entityCode" = v."name" FROM "vendors" v WHERE a."entityType" = 'Vendor' AND a."entityId" = v."id";
UPDATE "audit_logs" a SET "entityCode" = o."name" FROM "organizations" o WHERE a."entityType" = 'Organization' AND a."entityId" = o."id";
UPDATE "audit_logs" a SET "entityCode" = p."name" FROM "projects" p WHERE a."entityType" = 'Project' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "entityCode" = b."code" FROM "businesses" b WHERE a."entityType" = 'Business' AND a."entityId" = b."id";
UPDATE "audit_logs" a SET "entityCode" = u."email" FROM "users" u WHERE a."entityType" = 'User' AND a."entityId" = u."id";

-- Existing quote remarks that only mean "no deviation" are cleared (same list as technical-deviation.ts).
UPDATE "rfq_quotes" SET "remarks" = NULL
  WHERE "remarks" IS NOT NULL AND lower(btrim("remarks", E' \t\r\n.,;:!')) IN (
    '', 'no', 'na', 'n/a', 'n.a', 'nil', 'nill', 'none', '-', '--', 'not applicable', 'nd',
    'no deviation', 'no deviations', 'no deviation from spec', 'no deviation from specs',
    'no deviation from specification', 'no deviation from specifications');
```

  Check every table/column name used above against `schema.prisma` `@@map`/`@map` before applying.
- [ ] **Step 4: Apply and regenerate.** Apply to dev and test, then `pnpm db:generate`. Verify on dev: `select count(*) filter (where "entityCode" is not null), count(*) from audit_logs;` shows most rows filled, and the four `*_hnsw_idx` indexes still exist.
- [ ] **Step 5: Add `"TenderSubmission"`** to `SCOPED_MODELS`. Add the types above. Map `entityCode` in `audit.mapper.ts#toAuditLogDto`.
- [ ] **Step 6: Run** `pnpm --filter @bmp/types exec tsc --noEmit`. Expected: 0 errors. Server typecheck will fail on the `remarks` rename; Task 2 fixes it.
- [ ] **Step 7: Commit** `feat(db): tender submissions, audit entity codes, quote technical deviation`.

---

### Task 2: Technical deviation (rename + normalise + display data)

**Files:**
- Create: `apps/server/src/modules/rfq/technical-deviation.ts`, `apps/server/src/modules/rfq/__tests__/technical-deviation.spec.ts`
- Modify:
  - `rfq.service.ts`, `rfq.repository.ts`, `rfq.mapper.ts`, `rfq.validation.ts`, `quote-sheet.ts`, `rfq-document.ts`
  - `apps/server/templates/rfr.docx` (header text only)
  - `apps/server/src/modules/boq/boq.repository.ts` and `boq.mapper.ts` (deviation in `baseRateSource`)
  - existing RFQ tests/fakes referencing `remarks`

**Interfaces — Produces:** `normalizeTechnicalDeviation(text: string | null | undefined): string | null`. `BoqBaseRateSourceDto.technicalDeviation` filled from `baseRateQuote.technicalDeviation`.

- [ ] **Step 1: Write the failing test** `technical-deviation.spec.ts`:
  - `it.each(["", "  ", "No", "no.", "NA", "N/A", "n.a.", "Nil", "NILL", "None", "-", "--", "Not Applicable", "ND", "No deviation", "No Deviations.", "no deviation from specification"])("%j means no deviation", (t) => expect(normalizeTechnicalDeviation(t)).toBeNull())`
  - `expect(normalizeTechnicalDeviation(null)).toBeNull()`
  - `expect(normalizeTechnicalDeviation("  No ISI mark on supplied make ")).toBe("No ISI mark on supplied make")`
  - `expect(normalizeTechnicalDeviation("Make KEI instead of Polycab")).toBe("Make KEI instead of Polycab")`
- [ ] **Step 2: Run.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `normalizeTechnicalDeviation`: trim; strip leading/trailing ` \t\r\n.,;:!`; lowercase; compare to the Global Constraints list; return the original trimmed text otherwise.
- [ ] **Step 4: Rename through the RFQ module.**
  - Server code `remarks` → `technicalDeviation` (validation field `technicalDeviation: z.string().max(500).optional()`, repository `UpsertQuoteData`, mapper, `ParsedQuoteRow`).
  - Apply `normalizeTechnicalDeviation` in `RfqService.upsertQuote` and `importQuotes` before writing.
  - Quote sheet column `{ header: "Technical deviation (if any)", key: "technicalDeviation", width: 30 }`.
  - `RFR_COLUMNS` "Remarks" → "Technical deviation (if any)".
  - In `rfr.docx`, replace the header text: unzip, edit `word/document.xml`, re-zip with the same entry order. Confirm with `unzip -p apps/server/templates/rfr.docx word/document.xml | grep -c "Technical deviation (if any)"` → 1.
  - BOQ `baseRateQuote` select adds `technicalDeviation: true`, and the mapper fills `baseRateSource.technicalDeviation`.
- [ ] **Step 5: Add tests to `rfq.service.spec.ts`:**
  - `upsertQuote stores null for a "NA" deviation`
  - `importQuotes keeps a real deviation`: a sheet row with `"Make KEI"` in the deviation column (column L) → stored.
  - Update existing quote-sheet tests that read the Remarks column.
- [ ] **Step 6: Run** `pnpm --filter @bmp/server exec tsc --noEmit` (0 errors), then the rfq + boq unit specs and `technical-deviation.spec.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(rfq): technical deviation replaces quote remarks, normalised on write`.

---

### Task 3: Snapshot diff + readable summary (pure)

**Files:**
- Create: `apps/server/src/modules/tenders/submission-diff.ts`, `apps/server/src/modules/tenders/__tests__/submission-diff.spec.ts`

**Interfaces — Produces:**
- `export interface SubmissionSnapshot { reference: string | null; totalAmount: number; lines: TenderSubmissionLineDto[] }`
- `diffSubmissions(previous: SubmissionSnapshot, current: SubmissionSnapshot): SubmissionChanges`
- `renderSubmissionSummary(number: number, current: SubmissionSnapshot, previous: { number: number; snapshot: SubmissionSnapshot; changes: SubmissionChanges } | null): string`
- `formatInr(value: number, decimals: 0 | 2): string`, using `Intl.NumberFormat("en-IN")`, prefix `₹`.

Rendering rules (exact copy):
- **Header.** `Submission #<n>`. Then ` · ref <ref>` when a reference exists, plus ` (was <old ref or none>)` when changed. Then ` · total <₹ 0dp>`, plus ` (was <₹ 0dp>)` when changed. For #1, ` · <k> items` comes before the total.
- **No changes.** If `previous` is set and nothing changed, append the line `No changes since #<prev>`.
- **Sections**, in this order, each `"<Title> (<count>):"` followed by one `• ` bullet per line:
  - `Rates changed`: lines whose `changed` includes rate, baseRate, markupPercent or vendor. Bullet: `• <desc> — <₹2dp before or "no rate"> → <₹2dp after or "no rate">`. Append ` · <vendor before or "no vendor"> → <vendor after or "no vendor">` if the vendor changed. Append ` · markup <b>% → <a>%` if either markup is non-null (null shows as `-`).
  - `HSN changed`: `• <desc> — <b or "none"> → <a or "none">`
  - `Technical deviation changed`: `• <desc> — <none | "text"> → <none | "text">`
  - `Quantity changed`: `• <desc> — <b> → <a>`, plus ` <unit>` when the unit is set.
  - `Added`: `• <desc>`
  - `Removed`: `• <desc>`

- [ ] **Step 1: Write the failing tests:**
  - `first submission summary`: 2 lines, total 1240000, ref "ABC/123" → exactly `"Submission #1 · ref ABC/123 · 2 items · total ₹12,40,000"`.
  - `budgetary first submission has no ref segment`: ref null → `"Submission #1 · 2 items · total ₹…"`.
  - `reports rate, vendor and markup change in one bullet`: before rate 437, vendor "Polycab Traders", markup 15; after rate 415, vendor "Havells Dist.", markup 15 → output contains `"Rates changed (1):\n• XLPE Cable 4C×16 — ₹437.00 → ₹415.00 · Polycab Traders → Havells Dist. · markup 15% → 15%"`.
  - `reports HSN, deviation, quantity, added and removed`. Assert each exact bullet:
    - `• XLPE — 8544 → 85444999`
    - `• XLPE — none → "Make KEI instead of Polycab"`
    - `• GI Pipe 50mm — 120 → 140 m`
    - `Added (1):\n• Cable gland 25mm`
    - `Removed (1):\n• Cable tray 300mm`
  - `reference and total change in header`: `"Submission #2 · ref ABC/124 (was ABC/123) · total ₹11,95,500 (was ₹12,40,000)"`.
  - `no changes`: the identical snapshot again → ends with `"\nNo changes since #1"`.
  - `matches re-uploaded lines by description + unit`: prev ids a,b; current ids x,y with the same descriptions/units and only one rate changed → `lines.length === 1`, `added === []`, `removed === []`.
  - `pairs duplicate description + unit lines one-to-one`: prev two "Bolt M8"/"nos" (ids a,b), current two with new ids → no added/removed, no changes.
- [ ] **Step 2: Run.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the three functions. Matching: first pass by `boqItemId`; second pass walks unmatched current lines in order and takes the first unmatched previous line with equal `description` + `unit`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tenders): submission snapshot diff and readable summary`.

---

### Task 4: Record submissions on fresh submit; history DTO

**Files:**
- Create: `apps/server/src/modules/tenders/tender-submissions.repository.ts`
- Modify: `tenders.service.ts`, `tenders.module.ts`, `apps/server/src/modules/boq/boq.repository.ts` (if the item include lacks the vendor name / deviation — it has them after Task 2)
- Test: `__tests__/tenders.service.spec.ts`, `__tests__/tenders.integration.spec.ts`

**Interfaces:**
- Produces: `ITenderSubmissionsRepository`:
  - `findLatest(tenderId: string, businessId: string): Promise<TenderSubmissionRow | null>`
  - `create(data: { businessId; tenderId; number; submissionReference: string | null; totalAmount: number; lines: TenderSubmissionLineDto[]; changes: SubmissionChanges | null; summary: string; submittedById: string }): Promise<TenderSubmissionRow>`

  `TenderSubmissionRow` = the Prisma row. `TendersService` constructor gains `submissionsRepository: ITenderSubmissionsRepository` as the last parameter.
- Consumes: `diffSubmissions` / `renderSubmissionSummary` (Task 3); `BoqItemWithBreakdown.baseRateQuote.{vendor.name, technicalDeviation}` (Task 2).

Behaviour in `changeStatus` when `input.status === "SUBMITTED"`:
1. `latest = findLatest(...)`.
2. `fresh = previousStatus === "DRAFT" || (previousStatus === "CANCELLED" && latest === null)`.
3. The lock gate stays for every move to SUBMITTED (Part 1).
4. Only when `fresh`:
   - the reference requirement (existing, with stored-reference fallback)
   - `recordOwnRates`
   - build the snapshot from current-BOQ leaf lines, with `reference = input.submissionReference ?? tender.submissionReference ?? null` and `totalAmount = round2(Σ line.amount ?? 0)`
   - `changes = latest ? diffSubmissions(latest snapshot, current) : null`
   - `summary = renderSubmissionSummary(latest ? latest.number + 1 : 1, …)`
   - create the submission, then put `submissionNumber` + `summary` into the `TENDER_STATUS_CHANGED` metadata
5. `getStatusHistory` maps `submission` from metadata when `submissionNumber` is present, else null.

- [ ] **Step 1: Write the failing unit tests**. Fake repository keeps rows in an array.
  - `fresh submission from DRAFT stores #1 with leaf lines only and logs its summary`: parent + 2 children → `lines.length === 2`, audit metadata has `submissionNumber: 1` and `summary` starting `"Submission #1"`.
  - `resubmission stores #2 compared with #1`: change one line's rate between submissions → summary contains `"Rates changed (1):"`.
  - `WON → SUBMITTED records only the status change`: no new submission; `replaceOwnRates` not called on that transition.
  - `undoing a cancel of a submitted tender is not a new submission`: SUBMITTED → CANCELLED → SUBMITTED → still 1 submission.
  - `CANCELLED straight from DRAFT then SUBMITTED is #1`.
  - `tender submitted before this feature becomes #1 on next fresh submit` (Review Focus 1): tender status SUBMITTED with no rows, revert to DRAFT, submit → #1.
  - `getStatusHistory exposes submission number, reference and summary`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the repository and the service changes. Wire with `new TenderSubmissionsRepository(prisma)` in `tenders.module.ts`.
- [ ] **Step 4: Add an integration test** in `tenders.integration.spec.ts`: `two submissions produce a readable change log`. Lock, submit with ref A, revert to DRAFT, unlock, change a BOQ item rate via `PATCH /boq-items/:id`, lock, submit with ref B. Then `GET /tenders/:id/status-history` shows the newest entry with `submission.number === 2`, and its `summary` contains `"(was A)"` and `"Rates changed (1):"`.
- [ ] **Step 5: Run** both specs (flush Redis first). Expected: PASS.
- [ ] **Step 6: Commit** `feat(tenders): numbered submission snapshots with change summary`.

---

### Task 5: Audit entity codes

**Files:**
- Create: `apps/server/src/modules/audit/entity-code.ts`, `apps/server/src/modules/audit/__tests__/entity-code.integration.spec.ts`, `apps/server/src/modules/audit/__tests__/audit.service.spec.ts` (if absent)
- Modify: `audit.service.ts`, `audit.repository.ts`, `audit.module.ts`, `audit.filter-columns.ts`, `audit.mapper.ts` (export column), `tenders.service.ts#delete` (pass `entityCode: tender.tenderNumber`)

**Interfaces — Produces:**
- `export type EntityCodeResolver = (entityType: string, entityId: string) => Promise<string | null>`
- `createEntityCodeResolver(prisma: PrismaClient): EntityCodeResolver`. Mapping per the spec. Items use `formatItemCodeForDisplay`, falling back to `canonicalName`.
- `CreateAuditLogData.entityCode?: string | null`. `AuditService` constructor becomes `(auditRepository, resolveEntityCode: EntityCodeResolver)`.
- Wire in `audit.module.ts` with the **unscoped** client: `import { prisma as basePrisma } from "@bmp/database"`. The global audit log resolves across businesses and AuditLog itself is not business-scoped.

- [ ] **Step 1: Write the failing tests:**
  - Unit, `AuditService.log`:
    - `stores the resolved entity code`
    - `keeps an explicitly passed entityCode without resolving`
    - `stores null when the resolver throws`
  - Integration, `entity-code.integration.spec.ts` with real rows: Tender → its tenderNumber; BoqItem → its tender's tenderNumber; Item with an 11-digit code → `"73 18 0042 001"` format; unknown type → null; missing id → null.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Add `entityCode: { type: "text", prismaPath: ["entityCode"], nullable: true }` to the filter columns.
  - Add sort `entityCode: (dir) => ({ entityCode: dir })`.
  - Add export column `{ key: "entityCode", header: "Entity" }`, plus a `details` export column with header "Details" holding `metadata.summary ?? ""`.
- [ ] **Step 4: Run** both specs plus `tenders.service.spec.ts` (its fake `AuditService` is unaffected). Expected: PASS.
- [ ] **Step 5: Commit** `feat(audit): readable entity code on every audit row`.

---

### Task 6: Web: History submissions, Audit Log columns, deviation markers

**Files:**
- Modify:
  - `apps/web/src/components/tenders/tender-history-tab.tsx`
  - `apps/web/src/components/audit-log/audit-log-column-registry.tsx`
  - `apps/web/src/components/boq/boq-item-grid.tsx`
  - `apps/web/src/components/rfq/quote-cell.tsx` and its caller on `rfqs/[id]/page.tsx`
  - any web file referencing quote `remarks`

**Interfaces — Consumes:** `TenderStatusHistoryEntryDto.submission`, `AuditLogDto.entityCode`, `metadata.summary`, `BoqBaseRateSourceDto.technicalDeviation`, `RfqQuoteDto.technicalDeviation`.

- [ ] **Step 1: History tab.** An entry with `submission` shows a line `Submission #<n>` (plus ` · ref <reference>` when set) and a "Show changes" toggle. It reveals the summary in a `<pre className="whitespace-pre-wrap font-sans text-sm">`.
- [ ] **Step 2: Audit Log.**
  - Add column `entityCode`: label "Entity", type text, sortable, filterable, nullable, `defaultVisible: true`, after Entity Type.
  - Add column `details`: label "Details", not sortable/filterable, `defaultVisible: true`. It shows the first line of `metadata.summary`, with the full text in a `title` and a click-to-expand `<pre>`. Shows `-` when absent.
  - Keep the export-key comment in sync.
  - Add the new actions to `AUDIT_ACTIONS`: `RFQ_RATES_FINALIZED`, `TENDER_RATES_LOCKED`, `TENDER_RATES_UNLOCKED`. This also closes Part 1's deferred minor.
- [ ] **Step 3: Tender items grid.** When `baseRateSource.technicalDeviation` is set, the base-rate cell shows a small `AlertTriangle` (`text-warning`) next to the vendor name, with the deviation as its `title` and `aria-label`.
- [ ] **Step 4: RFQ quote cell.** Same marker when `quote.technicalDeviation` is set. Read-only; no editor.
- [ ] **Step 5: Run** web `tsc --noEmit` (ignore TS6053 `.next/types` noise if the dev server is up), then lint on the changed files and `pnpm exec vitest run` in `apps/web`. Expected: 0 errors, lint clean, tests pass.
- [ ] **Step 6: Commit** `feat(web): submission change log on History, audit Entity/Details columns, deviation markers`.

---

### Task 7: Whole-branch verification

- [ ] **Step 1:** Per-package typecheck (`server`, `web`, `types`, `ui`, `database`), all 0 errors. Run `pnpm lint`: only the pre-existing `quotation-document.spec.ts:61` error is allowed.
- [ ] **Step 2:** Flush Redis, then run the full server suite. Compare with Part 1's baseline (login rate-limiter `accessToken/userId undefined` failures + the date-sensitive reminder test). No other failure categories. Re-run every integration file this branch touched in isolation; all must pass.
- [ ] **Step 3:** If the dev server is stopped, run `pnpm build`. Otherwise record it as not run.
- [ ] **Step 4:** Run `graphify update .`.
