# BMP — Phase 3 (BOQ & Estimation) Implementation Plan (draft — not yet approved/built)

> Written directly from the master spec + established Phase 1/2 patterns, without the full
> interactive plan-mode research pass, due to a context budget constraint flagged mid-session.
> Treat this as a strong first draft — worth a quick sanity re-read before implementation starts,
> since it wasn't cross-checked against fresh code exploration the way Phase 1/2's plans were.

## Context

Builds on Phase 2 (tenders exist, with the generic `Attachment` system already supporting versioned
document slots). Phase 3 covers the master spec's BOQ Module (§8) and Rate Analysis Module (§9):
upload a BOQ (Excel/PDF), parse it into structured line items, provide an editable nested grid with
auto-calculation, maintain historical material/labor/machinery rates, and support cost estimation +
comparison against previous tenders.

## Scope decisions

- **PDF parsing is best-effort.** Excel (`.xlsx` via `exceljs`, already in the target stack) parses
  reliably into rows. PDF tables do not — scope PDF import as "extract text, heuristic row-splitting,
  always land in the same manual-review/edit screen as Excel" rather than promising lossless
  extraction. Don't over-invest here; the editable grid is the real safety net either way.
- **Column mapping is a confirm step, not magic.** BOQ spreadsheets vary (different column orders/
  headers). Upload → parse → show a preview table with a column-mapping UI (map source columns to
  description/unit/quantity/rate/category) → confirm → commit as `BoqItem` rows. No AI/ML guessing
  in this phase; simple header-name heuristics (fuzzy match "qty"/"quantity", "rate"/"unit rate",
  etc.) to pre-fill the mapping, always user-confirmable.
- **Versioning reuses the Attachment-document-version pattern**, not a new mechanism: `Boq` gets its
  own `groupId`/`version`/`isCurrent` columns, same shape as `Attachment.documentGroupId`. The
  uploaded source file itself still goes through the existing generic `AttachmentsService`
  (`entityType: "Tender"`, `documentType: "BOQ"`) — `Boq`/`BoqItem` are the *parsed, structured* data,
  separate from the file.
- **Rate analysis is a per-BOQ-item cost breakdown**, not a separate workflow: material + labor +
  machinery + transport costs, overhead/profit/tax percentages, computed into a suggested rate.
  Historical rates (`HistoricalRate` model, one table across material/labor/machinery/transport
  categories) back a lookup/suggestion endpoint — not a forecasting model, just "what did we pay for
  this item last time."
- **New shared grid component is warranted**: nested, inline-editable rows with bulk operations
  don't fit the existing (server-paginated, non-editable) `DataTable`. Build
  `packages/ui/src/components/editable-tree-table.tsx` as a generic primitive (rows with a
  `parentId`/`children`, inline-editable cells, row selection for bulk actions) — Phase 4's Purchase
  Order line items will very likely reuse it, so make it generic now rather than BOQ-specific.

## Prisma schema additions

```
model Boq {
  id                  String   @id @default(uuid())
  tenderId            String
  tender              Tender   @relation(fields: [tenderId], references: [id], onDelete: Cascade)
  sourceAttachmentId  String?  // the uploaded Excel/PDF, via the existing Attachment system
  groupId             String?  // self-relation, same version-chain pattern as Attachment
  version             Int      @default(1)
  isCurrent           Boolean  @default(true)
  status              BoqStatus @default(DRAFT)  // DRAFT | FINALIZED
  createdById         String
  createdBy           User     @relation(fields: [createdById], references: [id], onDelete: Restrict)
  items               BoqItem[]
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  @@index([tenderId])
  @@index([groupId])
}

model BoqItem {
  id            String    @id @default(uuid())
  boqId         String
  boq           Boq       @relation(fields: [boqId], references: [id], onDelete: Cascade)
  parentId      String?   // nested categories/subcategories, self-relation
  parent        BoqItem?  @relation("BoqItemChildren", fields: [parentId], references: [id], onDelete: Cascade)
  children      BoqItem[] @relation("BoqItemChildren")
  itemCode      String?
  description   String
  category      String?
  unit          String?
  quantity      Float?
  rate          Float?
  amount        Float?    // quantity * rate, recomputed on write, not trusted from client
  remarks       String?
  sortOrder     Int       @default(0)
  rateBreakdown BoqItemRateBreakdown?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  @@index([boqId])
  @@index([parentId])
}

model BoqItemRateBreakdown {
  id               String  @id @default(uuid())
  boqItemId        String  @unique
  boqItem          BoqItem @relation(fields: [boqItemId], references: [id], onDelete: Cascade)
  materialCost     Float   @default(0)
  laborCost        Float   @default(0)
  machineryCost    Float   @default(0)
  transportCost    Float   @default(0)
  overheadPercent  Float   @default(0)
  profitPercent    Float   @default(0)
  taxPercent       Float   @default(0)
  computedRate     Float   // derived, recomputed server-side on every write
  updatedAt        DateTime @updatedAt
}

enum HistoricalRateCategory { MATERIAL LABOR MACHINERY TRANSPORT }

model HistoricalRate {
  id           String                 @id @default(uuid())
  category     HistoricalRateCategory
  itemName     String
  unit         String
  rate         Float
  location     String?
  effectiveDate DateTime
  sourceTenderId String?              // optional traceability back to the tender it came from
  notes        String?
  createdById  String
  createdBy    User                   @relation(fields: [createdById], references: [id], onDelete: Restrict)
  createdAt    DateTime               @default(now())
  @@index([category, itemName])
}

enum BoqStatus { DRAFT FINALIZED }
```

`Tender` gains `boqs Boq[]`; `User` gains `createdBoqs Boq[]` and `createdHistoricalRates HistoricalRate[]`.

## Backend modules (`apps/server/src/modules/`)

- **`boq/`** — `boq.repository.ts/.service.ts/.controller.ts/.routes.ts/.validation.ts/.mapper.ts/.module.ts`,
  following the exact established pattern. Key service methods: `parseUpload(fileBuffer, mimeType)`
  → preview rows (no DB writes yet — pure parse, returned to the client for column-mapping
  confirmation); `commitBoq(tenderId, mappedRows, replacesBoqId?)` → creates a new `Boq` version +
  `BoqItem` tree in a transaction, recomputing `amount` server-side (never trust client math);
  `updateItem`/`bulkUpdateItems` (e.g. "increase all MATERIAL category rates by 5%") — bulk op is a
  single transaction, not N requests; `getVersions`/`compareVersions`; `compareAcrossTenders(tenderIds[])`
  for the estimate-comparison view.
- **`rates/`** — `HistoricalRate` CRUD + `GET /rates/suggest?category=&itemName=` (fuzzy/`contains`
  match, most recent N rates for that item, used by the frontend rate-analysis panel to prefill).

Endpoints (permission column mirrors the existing `tenders:*` pattern):

| Method & Path | Permission |
|---|---|
| POST /tenders/:id/boq/parse (multipart, returns preview, no DB write) | `boq:create` |
| POST /tenders/:id/boq (commit parsed/mapped rows as a new version) | `boq:create` |
| GET /tenders/:id/boq (current version, full item tree) | `boq:read` |
| GET /tenders/:id/boq/versions | `boq:read` |
| PATCH /boq-items/:itemId | `boq:update` |
| POST /boq-items/bulk-update | `boq:update` |
| PUT /boq-items/:itemId/rate-analysis | `boq:update` |
| GET /tenders/:id/boq/compare?withTenderId= | `boq:read` |
| GET /rates, GET /rates/suggest | `rates:read` |
| POST /rates | `rates:create` |

RBAC additions to `packages/types/src/rbac.ts`: `boq:{create,read,update,delete}`,
`rates:{create,read,update}`. Estimator gets full `boq:*`+`rates:*` (this is their core job per the
spec: "Prepares BOQs, fills rates, generates estimates"); Tender Manager gets read-only on both
(oversight, not authorship); other operational roles read-only; Viewer read-only.

## Frontend

- `apps/web/src/app/(dashboard)/tenders/[id]/boq/page.tsx` — upload dropzone → column-mapping
  preview table → commit, OR (if a current BOQ exists) the editable tree grid directly.
- New `packages/ui` component `editable-tree-table.tsx` (generic, as scoped above) powers the grid:
  expand/collapse nested rows, inline-editable quantity/rate cells (amount auto-computed and
  read-only), row checkboxes for bulk actions, a toolbar slot for "apply % adjustment to selected."
- A rate-analysis side panel/drawer per line item: the cost-breakdown form (material/labor/
  machinery/transport/overhead%/profit%/tax%) with a live-computed rate, plus a "suggested rate"
  chip sourced from `GET /rates/suggest` that the user can accept or ignore.
- A comparison view (`tenders/[id]/boq/compare`) — pick another tender, show item-by-item rate
  deltas side by side (reuses `editable-tree-table` in read-only mode, or a simpler two-column diff
  table if the tree-table doesn't fit a comparison layout well — decide once the component exists).

## Testing

Unit tests (fake repos, matching existing style): BOQ parse→commit produces correct nested
structure and server-recomputed amounts; bulk-update applies percentage adjustments correctly and
atomically; rate-breakdown computed-rate math; rate suggestion query filtering. Integration test:
upload a small fixture `.xlsx`, commit, fetch back, confirm item tree matches.

## Build order

1. Prisma schema additions + migration + RBAC matrix update
2. `rates/` module (no dependencies on BOQ, build first)
3. `boq/` module: parse (exceljs) → commit → CRUD → bulk-update → versions → cross-tender compare
4. Backend tests
5. `packages/ui`: `editable-tree-table.tsx`
6. Frontend: upload/mapping flow → editable grid page → rate-analysis panel → comparison view
7. Install deps (`exceljs`, a PDF text-extraction library), typecheck, lint, build, test
8. Browser walkthrough: upload a real BOQ Excel, confirm mapping, edit quantities/rates inline,
   bulk-adjust a category, fill a rate breakdown with a suggested rate, create a second version,
   compare two tenders' BOQs

## Critical files (once built)

- `packages/database/prisma/schema.prisma`
- `apps/server/src/modules/boq/boq.service.ts` (parse/commit/bulk-update logic)
- `apps/server/src/modules/rates/rates.service.ts`
- `packages/ui/src/components/editable-tree-table.tsx`
- `packages/types/src/rbac.ts`, new `packages/types/src/boq.ts`

Phases 4–8 (Procurement, Project Execution, Finance, Reporting, Production hardening) remain out of
scope and will each get their own plan once Phase 3 is approved and built.

## Status: shipped and verified

Built as planned, with two pragmatic deviations:
- `pdf-parse` pinned to v1.1.4 (simple API) instead of the v2 rewrite (heavy pdfjs/canvas deps) —
  still best-effort text extraction as scoped, just without dragging in a worker/canvas dependency
  tree for a "land in the manual-edit screen anyway" code path.
- Added a `PATCH /tenders/:id/boq/finalize` endpoint (`BoqStatus.FINALIZED`) that wasn't itemized in
  the original endpoint table — needed so the `DRAFT`/`FINALIZED` enum in the schema was reachable
  from the API rather than dead state.

Verified: `pnpm turbo run lint typecheck build` clean across all 6 workspaces; 52/52 backend tests
passing (unit: BOQ tree-building/bulk-update/rate-analysis math/compare-matching, rates
suggest/filter; integration: upload→parse→commit→fetch→version against real Postgres+MinIO). Browser
walkthrough (Estimator role): upload a real `.xlsx` → confirm heuristic column mapping → commit →
inline-edit a rate → bulk +10% adjustment on a selected row → rate-analysis dialog with live computed
rate → compare page navigation. Screenshots confirm the editable tree grid, mapping preview, and
rate-analysis dialog all render and compute correctly.
