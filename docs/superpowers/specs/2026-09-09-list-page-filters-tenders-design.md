# List-Page Filters, Sort, Columns, Saved Views & Export — Design (Tenders pilot)

Date: 2026-09-09

## Problem

Every list page in the app (Tenders, RFQs, Items, Vendors, Organizations, Purchase Orders,
Projects, Bills, Users) shares one `DataTable` component, but each page hand-rolls its own filter
UI (usually just a search box + 0-2 dropdowns), and most have no column sorting, no column
show/hide, no export, and no saved filter presets. The user wants a Shopify-style filter-chip
builder, click-to-sort on every column, add/remove/reorder columns, saved views as tabs, and
CSV/XLSX export — applied consistently everywhere.

## Scope for this spec: Tenders only

This is deliberately a pilot. Full scope (9 pages × 5 features + 2 new backend subsystems) is too
large for one plan to be reviewable. This spec designs the generic mechanism and ships it
end-to-end on one page — Tenders, chosen because it already has the richest filter surface
(`ListTendersQuery` has 8 fields, only 3 wired into UI) and no computed/aggregate columns to
complicate the pilot. Once this ships and is verified live, a follow-up plan applies the same
mechanism to the remaining 8 pages.

## Explicitly deferred (confirmed with user, not in this spec)

- **Rollout to RFQs, Items, Vendors, Organizations, Purchase Orders, Projects, Bills, Users** —
  separate plan after this pilot is validated. Items in particular already does in-memory
  sort/pagination for computed columns (`items.service.ts:118-120`, flagged with a `ponytail:`
  comment) — the generic mechanism designed here needs a "computed column" escape hatch for that
  rollout, but Tenders doesn't need one, so it isn't designed in detail here.
- **Finance (Invoices/Expenses) list pages** — these don't exist today (`finance/page.tsx` is a
  KPI-card + card-grid layout, no `DataTable`, no pagination). Building them is a separate project;
  out of scope entirely.
- **Shared/team-visible saved views** — saved views are private-per-user only (user's explicit
  choice). No sharing, no new permission key for saved-view management.
- **URL-synced filter/sort/column state** — stays component state, matching every existing page
  (only Bills' one-off `tenderId` param is URL-driven today). No shareable filtered links.
- **Auto-restoring the last-used saved view on page load** — every page load starts at "Default".
- **Page-size selector / tunable page size in user settings** — item 9 from the original ask,
  user explicitly said to push this later.

## Current state (relevant facts, verified in code)

- `DataTable` (`packages/ui/src/components/data-table.tsx:19-56`) accepts `columns, data, isLoading,
  pageCount, pagination, onPaginationChange`, and optional `sorting`/`onSortingChange`. It has
  `manualPagination: true, manualSorting: true` and **no** `columnVisibility`, `columnOrder`,
  `columnFilters`, or `globalFilter` state anywhere — verified via grep, zero hits repo-wide for
  `columnVisibility|columnOrder|VisibilityState|ColumnOrderState`.
- `filter-bar.tsx` (`packages/ui/src/components/filter-bar.tsx`) is currently just a 15-line
  flex-wrap `<div>` — styling only, no chip/popover logic. Used only by the Tenders page today.
- Tenders' current filter/sort backend path: `ListTendersQuery`
  (`packages/types/src/tender.ts:271-283`) → `listTendersQuerySchema`
  (`apps/server/src/modules/tenders/tenders.validation.ts:112-125`) →
  `TendersRepository.findMany` where-clause (`tenders.repository.ts:172-213`), which builds a
  `Prisma.TenderWhereInput` from `businessId, status, kind, clientId, priority`, a `department`
  `contains`, an `assignees.some.userId` relation filter, a `submissionDate` range, and a `search`
  OR-block over `title`/`tenderNumber`. `orderBy: { createdAt: "desc" }` is hardcoded — **no sort
  control exists today**. The Tenders page (`tenders/page.tsx`) only wires 3 of these 8 fields into
  UI (kind tabs, status select, priority select) plus the search box.
- Column display today: `buildTenderTableColumns({ canGenerateDocument })`
  (`apps/web/src/components/tenders/tender-table-columns.tsx`, 83 lines) returns
  `ColumnDef<TenderListItemDto>[]` for `tenderNumber, title, client, status, priority,
  submissionDate, assigneeCount` (+ a conditional actions column). No column is sortable.
- No `SavedView`/`UserPreference`/similar model exists anywhere in
  `packages/database/prisma/schema.prisma` (49 models, grepped, zero matches). The only per-user
  settings surface is the single scalar `UserBusiness.themeColor`.
- No CSV/XLSX export exists for any list page. `exceljs` is already a backend dependency (used only
  by the Reports module) — nothing in `apps/web` for export. `reports.export.ts` has
  `exportTableToXlsx(table: ExportableTable)` (xlsx via ExcelJS) and `exportTableToPdf` (PDFKit),
  wired into `GET /reports/:reportKey/export?format=xlsx|pdf` — reused report tables, not raw list
  rows, no CSV option.
- Items' `SortHeader` (`items/page.tsx:46-64`) is the only existing click-to-sort UI in the app — a
  local, hand-rolled component calling `column.getToggleSortingHandler()`/`column.getIsSorted()`
  directly. Worth promoting to `packages/ui` rather than Tenders re-inventing it.
- RBAC convention (`packages/types/src/rbac.ts`): flat `"resource:action"` keys,
  `requirePermission(key)` middleware, `hasPermission(roleName, key)` on the frontend. Self-scoped
  routes (own profile/avatar/sessions) skip `requirePermission` and check ownership in the service —
  the precedent this spec's saved-views routes follow.

## Architecture overview

One idea drives everything: each list page declares a single **column registry** — an array of
column descriptors that is the one source of truth for the table's display columns, the filter
column picker, the show/hide column picker, and what's sortable. Today these are four separate,
independently-maintained things per page (or don't exist at all). The registry replaces that.

```ts
// packages/types/src/list-columns.ts
export type FilterColumnType = "text" | "number" | "date" | "enum" | "boolean";

export type FilterOperator =
  | "is" | "is_not" | "contains" | "has_any_value"
  | "gt" | "lt" | "between"
  | "before" | "after"
  | "any_of";

export interface FilterCondition {
  columnKey: string;
  operator: FilterOperator;
  /** string for text/enum/date(ISO), number for number, [min,max] for between, string[] for any_of */
  value: string | number | (string | number)[];
}
```

Operator sets by column type (frontend derives the operator list shown in the popover from the
column's type):

| Type | Operators |
|---|---|
| text | is, is_not, contains, has_any_value* |
| number | is, gt, lt, between, has_any_value* |
| date | is, before, after, between, has_any_value* |
| enum | is, is_not, any_of, has_any_value* |
| boolean | is |

`*has_any_value` (field is not null) only appears for columns the registry marks `nullable: true` —
required fields (e.g. `title`, `tenderNumber`) never offer it.

The frontend column registry entry (superset of a `ColumnDef`):

```ts
interface ListColumn<TRow> {
  key: string;                 // stable id, matches backend's allow-listed filter/sort key
  label: string;
  type: FilterColumnType;
  cell: ColumnDef<TRow>["cell"];   // existing per-column render logic, unchanged
  sortable: boolean;
  filterable: boolean;
  nullable?: boolean;          // gates the has_any_value operator
  enumOptions?: { value: string; label: string }[]; // for type "enum"
  defaultVisible: boolean;
  defaultOrder: number;
}
```

Backend mirrors this with a per-module allow-list (not the full descriptor — just enough to
validate and translate):

```ts
// apps/server/src/modules/tenders/tenders.filter-columns.ts
interface FilterableColumnDescriptor {
  type: FilterColumnType;
  prismaPath: string[];   // ["title"] or ["client", "name"] for a relation
  nullable?: boolean;
}
const TENDER_FILTER_COLUMNS: Record<string, FilterableColumnDescriptor> = {
  tenderNumber: { type: "text", prismaPath: ["tenderNumber"] },
  title: { type: "text", prismaPath: ["title"] },
  clientName: { type: "text", prismaPath: ["client", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  kind: { type: "enum", prismaPath: ["kind"] },
  priority: { type: "enum", prismaPath: ["priority"] },
  department: { type: "text", prismaPath: ["department"], nullable: true },
  submissionDate: { type: "date", prismaPath: ["submissionDate"], nullable: true },
};
const TENDER_SORT_COLUMNS: Record<string, Prisma.TenderOrderByWithRelationInput> = {
  tenderNumber: { tenderNumber: "asc" }, // direction overridden at call time
  title: { title: "asc" },
  clientName: { client: { name: "asc" } },
  status: { status: "asc" },
  priority: { priority: "asc" },
  submissionDate: { submissionDate: "asc" },
  createdAt: { createdAt: "asc" },
  assigneeCount: { assignees: { _count: "asc" } },
};
```

`assigneeCount` is **sortable but not filterable** — Prisma supports `orderBy` on a relation
`_count` but not a `where` filter on it (no `where: { assignees: { _count: ... } } }` in Prisma's
query API). This is called out explicitly so the implementer doesn't try and hit a dead end.

A shared helper translates validated `FilterCondition[]` into a `Prisma.WhereInput`:

```ts
// apps/server/src/shared/utils/filtering.ts
export function buildPrismaFilterWhere<T extends Record<string, unknown>>(
  filters: FilterCondition[],
  descriptors: Record<string, FilterableColumnDescriptor>,
): T
```

For each condition: look up its descriptor by `columnKey` (already validated against the allow-list
by zod before this runs — unknown keys can't reach here), build a nested object along
`prismaPath` (e.g. `["client","name"]` → `{ client: { name: { contains: value, mode:
"insensitive" } } }`), operator → Prisma predicate (`is`→equals, `is_not`→`not`,
`contains`→`contains`+`insensitive`, `gt`→`gt`, `lt`→`lt`, `between`→`gte`+`lte`,
`before`→`lt`, `after`→`gt`, `any_of`→`in`, `has_any_value`→`not: null`). Multiple conditions on
different columns AND together; the existing free-text `search` box stays a separate, independent
OR-block over `title`/`tenderNumber` — both apply simultaneously (matches how Shopify's own search
box + filter chips coexist in the reference screenshot).

## Data model: saved views

```prisma
model SavedView {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  pageKey        String   // "tenders" for this pilot; other pages add their own string later
  name           String
  filters        Json     // FilterCondition[]
  visibleColumns Json     // string[] of column keys
  columnOrder    Json     // string[] of column keys, full order
  sortBy         String?
  sortDir        String?  // "asc" | "desc"

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, businessId, pageKey, name])
  @@index([userId, businessId, pageKey])
  @@map("saved_views")
}
```

The "Default" tab (registry defaults, no filters) is never a DB row — it's a client-side constant
always shown first. Only user-created views are `SavedView` rows.

## Backend: saved-views module

New module, `apps/server/src/modules/saved-views/` (repository/service/controller/routes/
validation/mapper — standard shape per CLAUDE.md's module convention):

```
GET    /saved-views?pageKey=tenders   -> SavedViewDto[]  (only the caller's own, this business)
POST   /saved-views                   -> body { pageKey, name, filters, visibleColumns, columnOrder, sortBy?, sortDir? }
PATCH  /saved-views/:id               -> partial update (rename and/or replace contents)
DELETE /saved-views/:id
```

All routes: `authenticateMiddleware` only, no `requirePermission` — the service checks
`existingView.userId === req.user.id` and throws `NotFoundError` (not `ForbiddenError`) on
mismatch, so a user can't even confirm another user's view id exists. This mirrors the existing
self-scoped-route convention (own profile/avatar). `businessId` comes from the authenticated
session's active business, same as every other business-scoped module.

```ts
interface SavedViewDto {
  id: string;
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy: string | null;
  sortDir: "asc" | "desc" | null;
  createdAt: string;
  updatedAt: string;
}
```

## Backend: Tenders filter/sort query + export

`ListTendersQuery` gains `filters` (JSON-encoded `FilterCondition[]`, parsed + validated against
`TENDER_FILTER_COLUMNS`), `sortBy` (validated against `TENDER_SORT_COLUMNS` keys), `sortDir`. The
existing 8 hand-declared fields (`status, kind, clientId, ...`) stay as-is — they're simple
top-level equality/range filters the page's non-chip controls (kind tabs, status/priority selects)
still use directly; the new `filters` array is additive, for the chip-builder-driven conditions.
Both get ANDed into the same `where`.

Export: `GET /tenders/export?format=csv|xlsx&scope=view|all&columns=<comma-separated keys>&<same
filter/sort/search params as the list endpoint>`.

- Rebuilds the identical `where`/`orderBy` as the list query (same helper, same allow-lists) — no
  duplicated filter logic between list and export.
- `scope=view`: same `page`/`pageSize` as the list call (exports exactly what's currently on
  screen).
- `scope=all`: no pagination, but capped — fetch `take: EXPORT_MAX_ROWS + 1`
  (`EXPORT_MAX_ROWS = 50_000`, a constant in `config/constants.ts`); if the result has more than
  the cap, respond `400 BadRequestError` ("Narrow your filters — more than 50,000 rows match")
  instead of silently truncating.
- `columns`: which registry keys to include, in order — defaults to all registry keys if omitted,
  but normally the frontend passes exactly the currently-visible columns in their current order, so
  the exported file matches what's on screen.
- Response: `Content-Disposition: attachment; filename="tenders-export-YYYY-MM-DD.csv|xlsx"`,
  correct `Content-Type` per format.
- Permission: reuses `tenders:read` — no new `tenders:export` key. If you can see the list, you can
  export what you can see.

`exportTableToXlsx` moves out of `reports.export.ts` into a shared
`apps/server/src/shared/utils/table-export.ts`, alongside a new sibling `exportTableToCsv` (hand-
rolled writer — comma/quote/newline escaping, no new dependency, same approach
`document-generation/quotation-document.ts#buildQuotationCsv` already uses). Both operate on the
same `{ columns: {key,label}[], rows: Record<string,string|number|null>[] }` shape. `reports.export.ts`
re-exports from the new location (or `reports.controller.ts` just imports from the new path
directly) so the Reports module's existing xlsx/pdf export is untouched.

## Frontend: new/changed `packages/ui` components

- **`FilterBar`** (rewrite, replacing the 15-line placeholder): renders active filter chips (`"{label} {operatorLabel} {valueLabel}" ✕`), a `+` button opening `AddFilterPopover`, and a `Clear all` button (shown only when ≥1 filter is active). Clicking an existing chip reopens the popover pre-filled with that condition (edit-in-place, not remove-and-readd).
- **`AddFilterPopover`**: two-panel layout matching the reference screenshot — left list of filterable columns (from the registry, `filterable: true` only), right panel appears once a column is picked: operator radio group (options depend on the column's `type`), a value input matching the operator (text input, number input, date picker, single-select or multi-select for enum, two inputs for `between`), then `Cancel`/`Apply Filter`.
- **`ColumnPicker`**: popover triggered by a "Columns" button — checkbox per registry column (visibility) + drag handle (reorder) via `@dnd-kit/core` + `@dnd-kit/sortable` (new dependency — nothing in the repo does drag-and-drop today; dnd-kit is the current maintained standard, react-beautiful-dnd is unmaintained upstream). A "Reset to default" link restores `defaultVisible`/`defaultOrder`.
- **`SortableHeader`**: promoted from Items' local `SortHeader` (`items/page.tsx:46-64`) into `packages/ui`, so every page's sortable columns share one header component instead of re-implementing the click handler.
- **`SavedViewTabs`**: horizontal tab row — "Default" (always first, not deletable) + the user's `SavedView`s for this `pageKey`. Selecting a tab replaces the page's current filters/columns/order/sort. A "Save as view" affordance (visible whenever current state differs from the active tab) prompts for a name and creates a new `SavedView`. Each non-Default tab has an overflow menu: rename, update (save current state back into this view), delete.
- **`DataTable`** (`packages/ui/src/components/data-table.tsx`): gains optional `columnVisibility`/`onColumnVisibilityChange` and `columnOrder`/`onColumnOrderChange` props, wired into `useReactTable`'s `state` — both already exist in TanStack Table v8, just never plumbed through this wrapper. No client-side filtering added to DataTable itself (`getFilteredRowModel` stays unused) — filtering is fully server-driven, same as pagination/sorting already are.

## Frontend: Tenders page wiring

- New `apps/web/src/components/tenders/tender-column-registry.ts` — the `ListColumn<TenderListItemDto>[]` array, superseding the plain `ColumnDef[]` that `buildTenderTableColumns` returns today (that function's per-column `cell` logic is preserved, just attached to registry entries instead of a bare array).
- `tenders/page.tsx` gains: `SavedViewTabs` above the existing search/kind-tabs row; `FilterBar` + `Add filter` + `Clear all` + a `Columns` button next to the existing search input; an `Export` dropdown (4 entries: current view × CSV/XLSX, all matching × CSV/XLSX) calling the new export endpoint via `apiClient`'s blob-response handling (mirrors the existing single-bill-PDF `downloadFile()` pattern in `apps/web/src/lib/download.ts`).
- `useTenders` (or wherever `ListTendersQuery` is sent) gains `filters`/`sortBy`/`sortDir` params; `DataTable`'s `sorting`/`onSortingChange` get wired for the first time on this page.
- New hooks in `apps/web/src/hooks/use-saved-views.ts`: `useSavedViews(pageKey)`, `useCreateSavedView()`, `useUpdateSavedView()`, `useDeleteSavedView()` — standard TanStack Query shape matching every other hook file.

## Testing

- Backend: hand-written-fake-repository unit tests for `buildPrismaFilterWhere` (one case per
  operator × type combination, plus the relation-path case for `clientName`), following this
  repo's no-mocking-framework convention. Integration test (supertest, real Postgres) for
  `GET /tenders?filters=...&sortBy=...` end-to-end, and for the export endpoint's `scope=view` vs
  `scope=all` and the `EXPORT_MAX_ROWS` cap. Integration test for saved-views CRUD ownership
  isolation (one user cannot list/update/delete another user's `SavedView`) — mirrors the existing
  business-isolation integration test pattern already in the repo
  (`procurement.integration.spec.ts`'s "rejects a mutating request against another business's X").
- Frontend: no React component-test setup exists in this repo (confirmed — none of the 11 list
  pages have any). Not introducing one for this feature. Verification is typecheck + a live-browser
  pass (per this session's standing instructions) covering: add a filter via each operator type,
  edit and remove a chip, Clear all, sort a column both directions, hide/show/reorder columns and
  confirm it persists across a saved view, save/rename/delete a view, and both export scopes ×
  both formats actually download a correctly-shaped file.
