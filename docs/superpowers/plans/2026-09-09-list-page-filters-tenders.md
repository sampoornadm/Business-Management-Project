# List-Page Filters, Sort, Columns, Saved Views & Export (Tenders Pilot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Shopify-style filter-chip builder, click-to-sort, column show/hide + drag-reorder,
private saved views, and CSV/XLSX export on the Tenders list page, built as reusable generic
`packages/ui` pieces + a shared backend filter/sort/export pattern, so a follow-up plan can roll
the same mechanism out to the other 8 list pages with minimal new design.

**Architecture:** A per-page "column registry" (one array per list page) drives table columns,
filter-column choices, column visibility/order, and sortability — replacing four previously
separate, hand-rolled things. Filters travel as a `FilterCondition[]` (shared type in
`@bmp/types`), validated server-side against a per-module allow-list and translated to a Prisma
`where` by one shared helper. Saved views are a new private-per-user Prisma model. Export reuses
the exact same filter/sort translation as the list endpoint.

**Tech Stack:** Next.js/React/TanStack Table v8/TanStack Query, Express/Prisma/PostgreSQL, Zod,
ExcelJS (already a backend dependency), `@dnd-kit` (new — column drag-reorder).

**Spec:** `docs/superpowers/specs/2026-09-09-list-page-filters-tenders-design.md`

## Global Constraints

- Scope is Tenders only. Do not touch RFQs, Items, Vendors, Organizations, Purchase Orders,
  Projects, Bills, Users, or Finance pages in this plan.
- Saved views are private per user — no sharing, no new RBAC permission key for them.
- Export reuses the existing `tenders:read` permission — do not add `tenders:export`.
- `packages/ui` must stay domain-agnostic and must NOT take a dependency on `@bmp/types` — the
  generic filter/column types it needs (`FilterColumnType`, `FilterOperator`, `FilterCondition`,
  `FilterableColumnDef`) are declared locally inside `packages/ui`, structurally identical to
  (but independently declared from) the same names in `@bmp/types`. This is deliberate, not an
  oversight — do not "fix" it into a cross-package import.
- `EXPORT_MAX_ROWS = 50_000` — `scope=all` export beyond this throws `400 BadRequestError` asking
  the user to narrow filters, rather than silently truncating or attempting an unbounded query.
- Every new/changed Prisma model query must include `businessId` in its `where` — `scoped-client.ts`
  (`apps/server/src/infra/prisma/scoped-client.ts`) throws at runtime for any `SCOPED_MODELS` model
  queried without one. `SavedView` is added to that set.
- After any `schema.prisma` change: hand-write the migration SQL (do not run plain
  `prisma migrate dev` — it prompts an interactive drift-correction dialog because of this
  database's pre-existing pgvector HNSW indexes, which Prisma cannot express in its schema DSL and
  treats as undeclared drift every time it re-diffs). Apply via
  `pnpm exec dotenv -e .env -- pnpm --filter @bmp/database migrate:deploy`, then always run
  `pnpm db:generate` afterward so the generated Prisma client picks up the new model (`prisma.savedView`
  stays `undefined` and every route on it 500s until this runs).
- Backend module shape follows this repo's standard split exactly:
  `*.repository.ts` (`I<Name>Repository` interface + class) / `*.service.ts` / `*.controller.ts`
  (`asyncHandler` + `sendSuccess`) / `*.routes.ts` (`authenticateMiddleware` +
  `requirePermission`/self-scoped + `validate(zod)` + `@openapi` JSDoc) / `*.validation.ts` (Zod) /
  `*.mapper.ts` / `*.module.ts` (composition root).
- Backend unit tests use hand-written fake repositories (no mocking framework beyond `vi.fn()` for
  injected service deps) — no `vitest-mock-extended` or similar. Integration tests
  (`*.integration.spec.ts`) hit the real Express app via supertest against the real test Postgres.
- No React component-test framework exists in this repo and none is being introduced here.
  Frontend correctness is typecheck + the live-browser verification pass in the final task.

---

## File Structure

**New shared types:**
- `packages/types/src/filtering.ts` — `FilterColumnType`, `FilterOperator`, `FilterCondition`.
- `packages/types/src/saved-view.ts` — `SavedViewDto`, `CreateSavedViewInput`, `UpdateSavedViewInput`.

**New backend shared utilities:**
- `apps/server/src/shared/utils/filtering.ts` — `FilterableColumnDescriptor`, `buildPrismaFilterWhere`.
- `apps/server/src/shared/utils/table-export.ts` — `ExportableTable`, `exportTableToXlsx`,
  `exportTableToCsv` (promoted out of the Reports module, which keeps only its PDF exporter).

**New backend module:**
- `apps/server/src/modules/saved-views/` — `saved-views.repository.ts`, `.service.ts`,
  `.controller.ts`, `.routes.ts`, `.validation.ts`, `.mapper.ts`, `.module.ts`.

**Changed backend (Tenders):**
- `apps/server/src/modules/tenders/tenders.filter-columns.ts` (new) — the allow-lists mapping
  Tenders' filterable/sortable column keys to Prisma paths.
- `tenders.validation.ts`, `tenders.repository.ts`, `tenders.service.ts`, `tenders.controller.ts`,
  `tenders.routes.ts`, `tenders.mapper.ts` — extended, not rewritten.

**New `packages/ui` primitives/components:**
- `components/popover.tsx` (new generic Radix Popover wrapper — nothing standalone exists yet).
- `components/sortable-header.tsx` (promoted out of Items' page-local `SortHeader`).
- `lib/filterable-column.ts` — packages/ui's own local `FilterColumnType`/`FilterOperator`/
  `FilterCondition`/`FilterableColumnDef` + operator-set/label helpers (see Global Constraints).
- `components/add-filter-popover.tsx`, `components/active-filter-chips.tsx`,
  `components/column-picker.tsx`, `components/saved-view-tabs.tsx`.
- `components/data-table.tsx` is NOT modified — column visibility/order is handled by the Tenders
  column registry (Task 16) rebuilding the `ColumnDef[]` array it hands to `DataTable`, not by
  TanStack's own `columnVisibility`/`columnOrder` state. See Task 13's note.

**New/changed frontend (Tenders):**
- `apps/web/src/hooks/use-saved-views.ts` (new).
- `apps/web/src/components/tenders/tender-column-registry.ts` — replaces
  `tender-table-columns.tsx` (deleted; its only importer is the Tenders page, updated in the same
  task chain).
- `apps/web/src/app/(dashboard)/tenders/page.tsx` — rewritten to wire everything in.

---

### Task 1: Shared filter & saved-view types

**Files:**
- Create: `packages/types/src/filtering.ts`
- Create: `packages/types/src/saved-view.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/tender.ts`

**Interfaces:**
- Produces: `FilterColumnType`, `FilterOperator`, `FILTER_OPERATORS`, `FilterCondition` (all from
  `filtering.ts`); `SavedViewDto`, `CreateSavedViewInput`, `UpdateSavedViewInput` (from
  `saved-view.ts`); `TENDER_FILTER_FIELDS`, `TenderFilterField`, `TENDER_SORT_FIELDS`,
  `TenderSortField` (added to `tender.ts`); `ListTendersQuery` gains `filters?: FilterCondition[]`,
  `sortBy?: TenderSortField`, `sortDir?: "asc" | "desc"`. Every later task (frontend and backend)
  imports these exact names.

- [ ] **Step 1: Create the filtering types**

`packages/types/src/filtering.ts`:
```ts
export type FilterColumnType = "text" | "number" | "date" | "enum" | "boolean";

export const FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "has_any_value",
  "gt",
  "lt",
  "between",
  "before",
  "after",
  "any_of",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterCondition {
  columnKey: string;
  operator: FilterOperator;
  value?: string | number | (string | number)[];
}
```

- [ ] **Step 2: Create the saved-view DTO types**

`packages/types/src/saved-view.ts`:
```ts
import type { FilterCondition } from "./filtering.js";

export interface SavedViewDto {
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

export interface CreateSavedViewInput {
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export type UpdateSavedViewInput = Partial<Omit<CreateSavedViewInput, "pageKey">>;
```

- [ ] **Step 3: Export both new files from the package index**

In `packages/types/src/index.ts`, insert alphabetically (after `./finance.js`, before `./item.js`):
```ts
export * from "./filtering.js";
```
And after `./report.js`, before `./rfq.js`:
```ts
export * from "./saved-view.js";
```

- [ ] **Step 4: Extend `tender.ts` with filter/sort field allow-lists and query fields**

In `packages/types/src/tender.ts`, add near the top (after the existing `TENDER_PRIORITIES` const):
```ts
export const TENDER_FILTER_FIELDS = [
  "tenderNumber",
  "title",
  "clientName",
  "status",
  "priority",
  "department",
  "submissionDate",
] as const;
export type TenderFilterField = (typeof TENDER_FILTER_FIELDS)[number];

export const TENDER_SORT_FIELDS = [
  "tenderNumber",
  "title",
  "clientName",
  "status",
  "priority",
  "submissionDate",
  "createdAt",
  "assigneeCount",
] as const;
export type TenderSortField = (typeof TENDER_SORT_FIELDS)[number];
```

Add the import at the top of the file:
```ts
import type { FilterCondition } from "./filtering.js";
```

Then extend the existing `ListTendersQuery` interface (`tender.ts:271-283`) by adding three fields
at the end, right before its closing brace:
```ts
  filters?: FilterCondition[];
  sortBy?: TenderSortField;
  sortDir?: "asc" | "desc";
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bmp/types typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/filtering.ts packages/types/src/saved-view.ts packages/types/src/index.ts packages/types/src/tender.ts
git commit -m "feat(types): add FilterCondition, SavedViewDto, and Tenders filter/sort field allow-lists"
```

---

### Task 2: Backend `buildPrismaFilterWhere` shared helper

**Files:**
- Create: `apps/server/src/shared/utils/filtering.ts`
- Create: `apps/server/src/shared/utils/__tests__/filtering.spec.ts`

**Interfaces:**
- Consumes: `FilterCondition`, `FilterOperator` from `@bmp/types` (Task 1).
- Produces: `FilterableColumnDescriptor` (`{ type: FilterColumnType; prismaPath: string[];
  nullable?: boolean }`), `buildPrismaFilterWhere(filters: FilterCondition[], descriptors:
  Record<string, FilterableColumnDescriptor>): Record<string, unknown>`. Task 7 (Tenders) and
  Task 6 (saved-views, indirectly via its own validation) consume this.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/shared/utils/__tests__/filtering.spec.ts`:
```ts
import { describe, expect, it } from "vitest";

import { buildPrismaFilterWhere, type FilterableColumnDescriptor } from "../filtering.js";

const DESCRIPTORS: Record<string, FilterableColumnDescriptor> = {
  title: { type: "text", prismaPath: ["title"] },
  clientName: { type: "text", prismaPath: ["client", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  submissionDate: { type: "date", prismaPath: ["submissionDate"], nullable: true },
  assigneeCount: { type: "number", prismaPath: ["assigneeCount"] },
};

describe("buildPrismaFilterWhere", () => {
  it("returns an empty object for no filters", () => {
    expect(buildPrismaFilterWhere([], DESCRIPTORS)).toEqual({});
  });

  it("builds an 'is' equality clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "is", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { equals: "DRAFT" } });
  });

  it("builds an 'is_not' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "is_not", value: "DRAFT" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { not: "DRAFT" } });
  });

  it("builds a 'contains' clause, case-insensitive", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "title", operator: "contains", value: "road" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ title: { contains: "road", mode: "insensitive" } });
  });

  it("builds a nested relation clause from a multi-segment prismaPath", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "clientName", operator: "contains", value: "Works" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ client: { name: { contains: "Works", mode: "insensitive" } } });
  });

  it("builds a 'has_any_value' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "submissionDate", operator: "has_any_value" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ submissionDate: { not: null } });
  });

  it("builds 'gt' and 'lt' clauses", () => {
    expect(
      buildPrismaFilterWhere([{ columnKey: "assigneeCount", operator: "gt", value: 2 }], DESCRIPTORS),
    ).toEqual({ assigneeCount: { gt: 2 } });
    expect(
      buildPrismaFilterWhere([{ columnKey: "assigneeCount", operator: "lt", value: 5 }], DESCRIPTORS),
    ).toEqual({ assigneeCount: { lt: 5 } });
  });

  it("builds a 'between' clause from a two-element value array", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "assigneeCount", operator: "between", value: [1, 3] }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ assigneeCount: { gte: 1, lte: 3 } });
  });

  it("builds 'before' and 'after' clauses", () => {
    expect(
      buildPrismaFilterWhere(
        [{ columnKey: "submissionDate", operator: "before", value: "2026-01-01" }],
        DESCRIPTORS,
      ),
    ).toEqual({ submissionDate: { lt: "2026-01-01" } });
    expect(
      buildPrismaFilterWhere(
        [{ columnKey: "submissionDate", operator: "after", value: "2026-01-01" }],
        DESCRIPTORS,
      ),
    ).toEqual({ submissionDate: { gt: "2026-01-01" } });
  });

  it("builds an 'any_of' clause", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "status", operator: "any_of", value: ["DRAFT", "SUBMITTED"] }],
      DESCRIPTORS,
    );
    expect(where).toEqual({ status: { in: ["DRAFT", "SUBMITTED"] } });
  });

  it("ANDs multiple conditions on different columns together", () => {
    const where = buildPrismaFilterWhere(
      [
        { columnKey: "status", operator: "is", value: "DRAFT" },
        { columnKey: "title", operator: "contains", value: "road" },
      ],
      DESCRIPTORS,
    );
    expect(where).toEqual({
      AND: [{ status: { equals: "DRAFT" } }, { title: { contains: "road", mode: "insensitive" } }],
    });
  });

  it("silently drops a condition whose columnKey has no descriptor", () => {
    const where = buildPrismaFilterWhere(
      [{ columnKey: "unknownColumn", operator: "is", value: "x" }],
      DESCRIPTORS,
    );
    expect(where).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/shared/utils/__tests__/filtering.spec.ts`
Expected: FAIL — `Cannot find module '../filtering.js'`.

- [ ] **Step 3: Implement `buildPrismaFilterWhere`**

`apps/server/src/shared/utils/filtering.ts`:
```ts
import type { FilterCondition, FilterColumnType, FilterOperator } from "@bmp/types";

export interface FilterableColumnDescriptor {
  type: FilterColumnType;
  prismaPath: string[];
  nullable?: boolean;
}

function buildPredicate(operator: FilterOperator, value: FilterCondition["value"]): Record<string, unknown> {
  switch (operator) {
    case "is":
      return { equals: value };
    case "is_not":
      return { not: value };
    case "contains":
      return { contains: value as string, mode: "insensitive" };
    case "has_any_value":
      return { not: null };
    case "gt":
      return { gt: value };
    case "lt":
      return { lt: value };
    case "before":
      return { lt: value };
    case "after":
      return { gt: value };
    case "between": {
      const [min, max] = value as [string | number, string | number];
      return { gte: min, lte: max };
    }
    case "any_of":
      return { in: value as (string | number)[] };
    default: {
      const exhaustive: never = operator;
      throw new Error(`Unsupported filter operator: ${String(exhaustive)}`);
    }
  }
}

function nestPath(path: string[], predicate: Record<string, unknown>): Record<string, unknown> {
  return path.reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: acc }), predicate);
}

export function buildPrismaFilterWhere(
  filters: FilterCondition[],
  descriptors: Record<string, FilterableColumnDescriptor>,
): Record<string, unknown> {
  const clauses = filters
    .map((filter) => {
      const descriptor = descriptors[filter.columnKey];
      if (!descriptor) return null;
      const predicate = buildPredicate(filter.operator, filter.value);
      return nestPath(descriptor.prismaPath, predicate);
    })
    .filter((clause): clause is Record<string, unknown> => clause !== null);

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0]!;
  return { AND: clauses };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/shared/utils/__tests__/filtering.spec.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/shared/utils/filtering.ts apps/server/src/shared/utils/__tests__/filtering.spec.ts
git commit -m "feat(server): add buildPrismaFilterWhere, the shared FilterCondition -> Prisma where translator"
```

---

### Task 3: Promote table export (XLSX move + new CSV writer)

**Files:**
- Create: `apps/server/src/shared/utils/table-export.ts`
- Create: `apps/server/src/shared/utils/__tests__/table-export.spec.ts`
- Modify: `apps/server/src/modules/reports/reports.export.ts`
- Modify: `apps/server/src/modules/reports/reports.service.ts`
- Modify: `apps/server/src/modules/reports/reports.controller.ts`

**Interfaces:**
- Produces: `ExportableTable` (`{ title: string; columns: { key: string; header: string }[]; rows:
  Record<string, string | number>[] }`), `exportTableToXlsx(table): Promise<Buffer>`,
  `exportTableToCsv(table): Buffer`. Task 8 (Tenders export) consumes both.

- [ ] **Step 1: Write the failing CSV test**

`apps/server/src/shared/utils/__tests__/table-export.spec.ts`:
```ts
import { describe, expect, it } from "vitest";

import { exportTableToCsv, type ExportableTable } from "../table-export.js";

describe("exportTableToCsv", () => {
  const table: ExportableTable = {
    title: "Test",
    columns: [
      { key: "name", header: "Name" },
      { key: "note", header: "Note" },
    ],
    rows: [
      { name: "Alpha", note: "plain" },
      { name: "Beta, LLC", note: 'has "quotes" and a comma' },
    ],
  };

  it("writes a header row followed by one row per data row", () => {
    const csv = exportTableToCsv(table).toString("utf-8");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Note");
    expect(lines[1]).toBe("Alpha,plain");
  });

  it("quotes and escapes a field containing a comma or double quote", () => {
    const csv = exportTableToCsv(table).toString("utf-8");
    const lines = csv.split("\r\n");
    expect(lines[2]).toBe('"Beta, LLC","has ""quotes"" and a comma"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/shared/utils/__tests__/table-export.spec.ts`
Expected: FAIL — `Cannot find module '../table-export.js'`.

- [ ] **Step 3: Create the shared table-export module**

`apps/server/src/shared/utils/table-export.ts`:
```ts
import ExcelJS from "exceljs";

export interface ExportableTable {
  title: string;
  columns: { key: string; header: string }[];
  rows: Record<string, string | number>[];
}

export async function exportTableToXlsx(table: ExportableTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.columns = table.columns.map((column) => ({ header: column.header, key: column.key, width: 22 }));
  sheet.addRows(table.rows);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportTableToCsv(table: ExportableTable): Buffer {
  const header = table.columns.map((column) => column.header);
  const dataLines = table.rows.map((row) => table.columns.map((column) => String(row[column.key] ?? "")));
  const lines = [header, ...dataLines].map((cols) => cols.map(escapeCsvField).join(","));
  return Buffer.from(lines.join("\r\n"), "utf-8");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/shared/utils/__tests__/table-export.spec.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Point the Reports module at the shared `ExportableTable` type and drop its own XLSX exporter**

In `apps/server/src/modules/reports/reports.service.ts`, remove the local `ExportableTable`
interface definition (currently at `reports.service.ts:45-49`) and replace it with an import:
```ts
import type { ExportableTable } from "../../shared/utils/table-export.js";
```
(add alongside the file's other imports; every other usage of `ExportableTable` in that file is
unchanged, since the shape is identical).

In `apps/server/src/modules/reports/reports.export.ts`, remove the `exportTableToXlsx` function and
its now-unused `import ExcelJS from "exceljs";` line, and change the remaining `ExportableTable`
import to come from the shared location:
```ts
import type { ExportableTable } from "../../shared/utils/table-export.js";
```
The file now contains only `exportTableToPdf` plus that import and the `PDFDocument` import.

In `apps/server/src/modules/reports/reports.controller.ts`, change:
```ts
import { exportTableToPdf, exportTableToXlsx } from "./reports.export.js";
```
to:
```ts
import { exportTableToPdf } from "./reports.export.js";
import { exportTableToXlsx } from "../../shared/utils/table-export.js";
```

- [ ] **Step 6: Run the full server test suite to confirm no regression**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/reports`
Expected: PASS, same test count as before this task (the move must not change Reports' exported
behavior — only where the function lives).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/shared/utils/table-export.ts apps/server/src/shared/utils/__tests__/table-export.spec.ts apps/server/src/modules/reports/reports.export.ts apps/server/src/modules/reports/reports.service.ts apps/server/src/modules/reports/reports.controller.ts
git commit -m "refactor(server): promote XLSX export + add CSV writer to a shared table-export util"
```

---

### Task 4: `SavedView` Prisma model, migration, and scoped-client registration

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260909120000_add_saved_views/migration.sql`
- Modify: `apps/server/src/infra/prisma/scoped-client.ts`

**Interfaces:**
- Produces: Prisma model `SavedView` (fields: `id, userId, businessId, pageKey, name, filters
  (Json), visibleColumns (Json), columnOrder (Json), sortBy (String?), sortDir (String?),
  createdAt, updatedAt`). Task 5 (repository) consumes the generated `SavedView` Prisma type.

- [ ] **Step 1: Add the `SavedView` model to the schema**

In `packages/database/prisma/schema.prisma`, add this model near `Notification` (after its
closing brace, before the "BOQ & Estimation" section comment at line 654):
```prisma
model SavedView {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation("SavedViewOwner", fields: [userId], references: [id], onDelete: Cascade)
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  pageKey        String
  name           String
  filters        Json
  visibleColumns Json
  columnOrder    Json
  sortBy         String?
  sortDir        String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, businessId, pageKey, name])
  @@index([userId, businessId, pageKey])
  @@map("saved_views")
}
```

Add the back-relation to `User` (in the relations block starting at `schema.prisma:30`, alongside
the existing `notifications Notification[] @relation("NotificationRecipient")` line):
```prisma
  savedViews             SavedView[]            @relation("SavedViewOwner")
```

Add the back-relation to `Business` (in its relations block, alongside the existing
`notifications Notification[]` line at `schema.prisma:153`):
```prisma
  savedViews      SavedView[]
```

- [ ] **Step 2: Hand-write the migration SQL**

Create `packages/database/prisma/migrations/20260909120000_add_saved_views/migration.sql`:
```sql
-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "visibleColumns" JSONB NOT NULL,
    "columnOrder" JSONB NOT NULL,
    "sortBy" TEXT,
    "sortDir" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_userId_businessId_pageKey_idx" ON "saved_views"("userId", "businessId", "pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_userId_businessId_pageKey_name_key" ON "saved_views"("userId", "businessId", "pageKey", "name");

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply the migration and regenerate the Prisma client**

Run, in order:
```bash
pnpm exec dotenv -e .env -- pnpm --filter @bmp/database migrate:deploy
pnpm db:generate
```
Expected: both succeed with no prompts (this is exactly the non-interactive path the Global
Constraints section calls out). If `migrate:deploy` reports the migration already applied, that's
fine — it's idempotent.

Also apply it to the test database so integration tests in later tasks can run:
```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/database migrate:deploy
```

- [ ] **Step 4: Add `SavedView` to `SCOPED_MODELS`**

In `apps/server/src/infra/prisma/scoped-client.ts`, add `"SavedView"` to the `SCOPED_MODELS` set
(next to `"Notification"`):
```ts
export const SCOPED_MODELS = new Set([
  "Tender",
  "Project",
  "Boq",
  "Rfq",
  "PurchaseOrder",
  "GoodsReceipt",
  "BankAccount",
  "Invoice",
  "Expense",
  "Payment",
  "HistoricalRate",
  "Notification",
  "SavedView",
]);
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bmp/database typecheck && pnpm --filter @bmp/server typecheck`
Expected: no errors (the generated client now has a `PrismaClient.savedView` delegate).

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260909120000_add_saved_views apps/server/src/infra/prisma/scoped-client.ts
git commit -m "feat(database): add SavedView model for private per-user saved list-page views"
```

---

### Task 5: `saved-views` repository + service (+ unit tests)

**Files:**
- Create: `apps/server/src/modules/saved-views/saved-views.repository.ts`
- Create: `apps/server/src/modules/saved-views/saved-views.mapper.ts`
- Create: `apps/server/src/modules/saved-views/saved-views.service.ts`
- Create: `apps/server/src/modules/saved-views/__tests__/saved-views.service.spec.ts`

**Interfaces:**
- Consumes: `FilterCondition`, `SavedViewDto` from `@bmp/types` (Task 1).
- Produces: `ISavedViewsRepository`, `CreateSavedViewData`, `UpdateSavedViewData`,
  `SavedViewsRepository`, `toSavedViewDto`, `SavedViewsService` with methods `list(userId,
  businessId, pageKey)`, `create(data)`, `update(id, userId, businessId, data)`, `delete(id,
  userId, businessId)`. Task 6 (controller/routes/module) consumes `SavedViewsService`.

- [ ] **Step 1: Write the mapper**

`apps/server/src/modules/saved-views/saved-views.mapper.ts`:
```ts
import type { SavedView } from "@bmp/database";
import type { FilterCondition, SavedViewDto } from "@bmp/types";

export function toSavedViewDto(entity: SavedView): SavedViewDto {
  return {
    id: entity.id,
    pageKey: entity.pageKey,
    name: entity.name,
    filters: entity.filters as unknown as FilterCondition[],
    visibleColumns: entity.visibleColumns as unknown as string[],
    columnOrder: entity.columnOrder as unknown as string[],
    sortBy: entity.sortBy,
    sortDir: entity.sortDir as "asc" | "desc" | null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 2: Write the repository**

`apps/server/src/modules/saved-views/saved-views.repository.ts`:
```ts
import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, SavedView } from "@bmp/database";
import type { FilterCondition } from "@bmp/types";

export interface CreateSavedViewData {
  userId: string;
  businessId: string;
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}

export type UpdateSavedViewData = Partial<Omit<CreateSavedViewData, "userId" | "businessId" | "pageKey">>;

export interface ISavedViewsRepository {
  findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]>;
  findById(id: string, businessId: string): Promise<SavedView | null>;
  create(data: CreateSavedViewData): Promise<SavedView>;
  update(id: string, data: UpdateSavedViewData): Promise<SavedView>;
  delete(id: string): Promise<void>;
}

export class SavedViewsRepository implements ISavedViewsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]> {
    return this.prisma.savedView.findMany({
      where: { userId, businessId, pageKey },
      orderBy: { createdAt: "asc" },
    });
  }

  findById(id: string, businessId: string): Promise<SavedView | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key filtered here —
    // businessId must also match, and there's no compound (id, businessId) unique constraint.
    return this.prisma.savedView.findFirst({ where: { id, businessId } });
  }

  create(data: CreateSavedViewData): Promise<SavedView> {
    return this.prisma.savedView.create({
      data: {
        id: randomUUID(),
        userId: data.userId,
        businessId: data.businessId,
        pageKey: data.pageKey,
        name: data.name,
        filters: data.filters as unknown as Prisma.InputJsonValue,
        visibleColumns: data.visibleColumns as unknown as Prisma.InputJsonValue,
        columnOrder: data.columnOrder as unknown as Prisma.InputJsonValue,
        sortBy: data.sortBy ?? null,
        sortDir: data.sortDir ?? null,
      },
    });
  }

  update(id: string, data: UpdateSavedViewData): Promise<SavedView> {
    return this.prisma.savedView.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.filters !== undefined
          ? { filters: data.filters as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.visibleColumns !== undefined
          ? { visibleColumns: data.visibleColumns as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.columnOrder !== undefined
          ? { columnOrder: data.columnOrder as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.sortBy !== undefined ? { sortBy: data.sortBy } : {}),
        ...(data.sortDir !== undefined ? { sortDir: data.sortDir } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.savedView.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Write the failing service unit tests**

`apps/server/src/modules/saved-views/__tests__/saved-views.service.spec.ts` (modeled directly on
`apps/server/src/modules/notifications/__tests__/notifications.service.spec.ts`'s
`markRead`/ownership test pattern):
```ts
import { randomUUID } from "node:crypto";

import type { SavedView } from "@bmp/database";
import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { CreateSavedViewData, ISavedViewsRepository, UpdateSavedViewData } from "../saved-views.repository.js";
import { SavedViewsService } from "../saved-views.service.js";

class FakeSavedViewsRepository implements ISavedViewsRepository {
  views = new Map<string, SavedView>();

  async findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]> {
    return [...this.views.values()].filter(
      (v) => v.userId === userId && v.businessId === businessId && v.pageKey === pageKey,
    );
  }

  async findById(id: string, businessId: string): Promise<SavedView | null> {
    const view = this.views.get(id);
    return view && view.businessId === businessId ? view : null;
  }

  async create(data: CreateSavedViewData): Promise<SavedView> {
    const now = new Date();
    const view = {
      id: randomUUID(),
      userId: data.userId,
      businessId: data.businessId,
      pageKey: data.pageKey,
      name: data.name,
      filters: data.filters,
      visibleColumns: data.visibleColumns,
      columnOrder: data.columnOrder,
      sortBy: data.sortBy ?? null,
      sortDir: data.sortDir ?? null,
      createdAt: now,
      updatedAt: now,
    } as unknown as SavedView;
    this.views.set(view.id, view);
    return view;
  }

  async update(id: string, data: UpdateSavedViewData): Promise<SavedView> {
    const view = this.views.get(id);
    if (!view) throw new Error("not found");
    const updated = { ...view, ...data, updatedAt: new Date() } as SavedView;
    this.views.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.views.delete(id);
  }
}

describe("SavedViewsService", () => {
  let repository: FakeSavedViewsRepository;
  let service: SavedViewsService;
  const userA = randomUUID();
  const userB = randomUUID();
  const businessX = randomUUID();
  const businessY = randomUUID();

  beforeEach(() => {
    repository = new FakeSavedViewsRepository();
    service = new SavedViewsService(repository);
  });

  it("lists only the caller's own views for the given page", async () => {
    await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });
    await service.create({
      userId: userB,
      businessId: businessX,
      pageKey: "tenders",
      name: "Not mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    const views = await service.list(userA, businessX, "tenders");
    expect(views).toHaveLength(1);
    expect(views[0]!.name).toBe("Mine");
  });

  it("allows the owner to update their own view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    const updated = await service.update(created.id, userA, businessX, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
  });

  it("rejects updating another user's view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.update(created.id, userB, businessX, { name: "Hijacked" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("throws NotFoundError for a missing view", async () => {
    await expect(service.update(randomUUID(), userA, businessX, { name: "X" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws NotFoundError when the view belongs to a different business", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.update(created.id, userA, businessY, { name: "X" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("allows the owner to delete their own view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await service.delete(created.id, userA, businessX);
    expect(await service.list(userA, businessX, "tenders")).toHaveLength(0);
  });

  it("rejects deleting another user's view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.delete(created.id, userB, businessX)).rejects.toThrow(ForbiddenError);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/saved-views/__tests__/saved-views.service.spec.ts`
Expected: FAIL — `Cannot find module '../saved-views.service.js'`.

- [ ] **Step 5: Write the service**

`apps/server/src/modules/saved-views/saved-views.service.ts`:
```ts
import type { SavedViewDto } from "@bmp/types";

import { ForbiddenError, NotFoundError } from "../../core/errors/HttpErrors.js";

import type { CreateSavedViewData, ISavedViewsRepository, UpdateSavedViewData } from "./saved-views.repository.js";
import { toSavedViewDto } from "./saved-views.mapper.js";

export class SavedViewsService {
  constructor(private readonly savedViewsRepository: ISavedViewsRepository) {}

  async list(userId: string, businessId: string, pageKey: string): Promise<SavedViewDto[]> {
    const views = await this.savedViewsRepository.findMany(userId, businessId, pageKey);
    return views.map(toSavedViewDto);
  }

  async create(data: CreateSavedViewData): Promise<SavedViewDto> {
    const view = await this.savedViewsRepository.create(data);
    return toSavedViewDto(view);
  }

  private async assertOwnedView(id: string, userId: string, businessId: string) {
    const view = await this.savedViewsRepository.findById(id, businessId);
    if (!view) throw new NotFoundError("Saved view not found");
    if (view.userId !== userId) throw new ForbiddenError("You cannot modify another user's saved view");
    return view;
  }

  async update(
    id: string,
    userId: string,
    businessId: string,
    data: UpdateSavedViewData,
  ): Promise<SavedViewDto> {
    await this.assertOwnedView(id, userId, businessId);
    const updated = await this.savedViewsRepository.update(id, data);
    return toSavedViewDto(updated);
  }

  async delete(id: string, userId: string, businessId: string): Promise<void> {
    await this.assertOwnedView(id, userId, businessId);
    await this.savedViewsRepository.delete(id);
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/saved-views/__tests__/saved-views.service.spec.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/saved-views/saved-views.repository.ts apps/server/src/modules/saved-views/saved-views.mapper.ts apps/server/src/modules/saved-views/saved-views.service.ts apps/server/src/modules/saved-views/__tests__/saved-views.service.spec.ts
git commit -m "feat(saved-views): add repository and service with owner-only update/delete"
```

---

### Task 6: `saved-views` controller, routes, validation, module wiring + integration test

**Files:**
- Create: `apps/server/src/modules/saved-views/saved-views.validation.ts`
- Create: `apps/server/src/modules/saved-views/saved-views.controller.ts`
- Create: `apps/server/src/modules/saved-views/saved-views.routes.ts`
- Create: `apps/server/src/modules/saved-views/saved-views.module.ts`
- Modify: `apps/server/src/routes/v1.router.ts`
- Create: `apps/server/src/modules/saved-views/__tests__/saved-views.integration.spec.ts`

**Interfaces:**
- Consumes: `SavedViewsService` (Task 5).
- Produces: `GET/POST /api/v1/saved-views`, `PATCH/DELETE /api/v1/saved-views/:id`. Task 15
  (`use-saved-views.ts` frontend hooks) consumes this HTTP contract.

- [ ] **Step 1: Write the validation schemas**

`apps/server/src/modules/saved-views/saved-views.validation.ts`:
```ts
import { FILTER_OPERATORS } from "@bmp/types";
import { z } from "zod";

const filterConditionSchema = z.object({
  columnKey: z.string().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

export const listSavedViewsQuerySchema = z.object({
  pageKey: z.string().min(1),
});
export type ListSavedViewsQueryParsed = z.infer<typeof listSavedViewsQuerySchema>;

export const createSavedViewSchema = z.object({
  pageKey: z.string().min(1),
  name: z.string().min(1).max(100),
  filters: z.array(filterConditionSchema),
  visibleColumns: z.array(z.string()),
  columnOrder: z.array(z.string()),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type CreateSavedViewBody = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = createSavedViewSchema.omit({ pageKey: true }).partial();
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewSchema>;
```

- [ ] **Step 2: Write the controller**

`apps/server/src/modules/saved-views/saved-views.controller.ts`:
```ts
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { SavedViewsService } from "./saved-views.service.js";
import type {
  CreateSavedViewBody,
  ListSavedViewsQueryParsed,
  UpdateSavedViewBody,
} from "./saved-views.validation.js";

export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  list = asyncHandler(async (req, res) => {
    const { pageKey } = req.query as unknown as ListSavedViewsQueryParsed;
    const views = await this.savedViewsService.list(req.user!.id, req.user!.businessId, pageKey);
    sendSuccess(res, views, "Saved views retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateSavedViewBody;
    const view = await this.savedViewsService.create({
      userId: req.user!.id,
      businessId: req.user!.businessId,
      pageKey: body.pageKey,
      name: body.name,
      filters: body.filters,
      visibleColumns: body.visibleColumns,
      columnOrder: body.columnOrder,
      sortBy: body.sortBy ?? null,
      sortDir: body.sortDir ?? null,
    });
    sendSuccess(res, view, "Saved view created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateSavedViewBody;
    const view = await this.savedViewsService.update(
      req.params.id!,
      req.user!.id,
      req.user!.businessId,
      body,
    );
    sendSuccess(res, view, "Saved view updated");
  });

  remove = asyncHandler(async (req, res) => {
    await this.savedViewsService.delete(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, null, "Saved view deleted");
  });
}
```

- [ ] **Step 3: Write the routes**

`apps/server/src/modules/saved-views/saved-views.routes.ts`:
```ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { SavedViewsController } from "./saved-views.controller.js";
import {
  createSavedViewSchema,
  listSavedViewsQuerySchema,
  updateSavedViewSchema,
} from "./saved-views.validation.js";

export function createSavedViewsRouter(controller: SavedViewsController): Router {
  const router = Router();

  /**
   * @openapi
   * /saved-views:
   *   get:
   *     tags: [SavedViews]
   *     summary: List the current user's saved views for one page
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: pageKey
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved views }
   *   post:
   *     tags: [SavedViews]
   *     summary: Save the current filters, columns, and sort as a new named view
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Saved view created }
   */
  router.get("/", authenticateMiddleware, validate(listSavedViewsQuerySchema, "query"), controller.list);
  router.post("/", authenticateMiddleware, validate(createSavedViewSchema), controller.create);

  /**
   * @openapi
   * /saved-views/{id}:
   *   patch:
   *     tags: [SavedViews]
   *     summary: Rename or update a saved view's contents (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved view updated }
   *   delete:
   *     tags: [SavedViews]
   *     summary: Delete a saved view (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved view deleted }
   */
  router.patch("/:id", authenticateMiddleware, validate(updateSavedViewSchema), controller.update);
  router.delete("/:id", authenticateMiddleware, controller.remove);

  return router;
}
```

- [ ] **Step 4: Write the module composition root**

`apps/server/src/modules/saved-views/saved-views.module.ts`:
```ts
import { prisma } from "../../infra/prisma/client.js";

import { SavedViewsController } from "./saved-views.controller.js";
import { SavedViewsRepository } from "./saved-views.repository.js";
import { createSavedViewsRouter } from "./saved-views.routes.js";
import { SavedViewsService } from "./saved-views.service.js";

const savedViewsRepository = new SavedViewsRepository(prisma);
export const savedViewsService = new SavedViewsService(savedViewsRepository);
const savedViewsController = new SavedViewsController(savedViewsService);

export const savedViewsRouter = createSavedViewsRouter(savedViewsController);
```

- [ ] **Step 5: Mount the router**

In `apps/server/src/routes/v1.router.ts`, add the import alongside the existing module imports
(e.g. next to the `notificationsRouter` import) and the mount line alongside the others
(e.g. next to `v1Router.use("/notifications", notificationsRouter);`):
```ts
import { savedViewsRouter } from "../modules/saved-views/saved-views.module.js";
```
```ts
v1Router.use("/saved-views", savedViewsRouter);
```

- [ ] **Step 6: Write the failing integration test**

`apps/server/src/modules/saved-views/__tests__/saved-views.integration.spec.ts`:
```ts
import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Saved views (integration)", () => {
  const app = createApp();
  let userOne: IntegrationTestUser;
  let userTwo: IntegrationTestUser;

  beforeAll(async () => {
    userOne = await createIntegrationTestUser(app);
    userTwo = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    await prisma.savedView.deleteMany({
      where: { userId: { in: [userOne.userId, userTwo.userId] } },
    });
    await cleanupIntegrationTestUser(userOne);
    await cleanupIntegrationTestUser(userTwo);
    await prisma.$disconnect();
  });

  it("creates a saved view and lists it back for its owner", async () => {
    const createResponse = await request(app)
      .post("/api/v1/saved-views")
      .set("Authorization", `Bearer ${userOne.accessToken}`)
      .send({
        pageKey: "tenders",
        name: "High priority",
        filters: [{ columnKey: "priority", operator: "is", value: "HIGH" }],
        visibleColumns: ["tenderNumber", "title"],
        columnOrder: ["tenderNumber", "title"],
      });
    expect(createResponse.status).toBe(201);

    const listResponse = await request(app)
      .get("/api/v1/saved-views")
      .query({ pageKey: "tenders" })
      .set("Authorization", `Bearer ${userOne.accessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].name).toBe("High priority");
  });

  it("does not let a different user see, rename, or delete another user's saved view", async () => {
    const createResponse = await request(app)
      .post("/api/v1/saved-views")
      .set("Authorization", `Bearer ${userOne.accessToken}`)
      .send({
        pageKey: "tenders",
        name: "Owner only",
        filters: [],
        visibleColumns: [],
        columnOrder: [],
      });
    const viewId = createResponse.body.data.id;

    const otherUsersList = await request(app)
      .get("/api/v1/saved-views")
      .query({ pageKey: "tenders" })
      .set("Authorization", `Bearer ${userTwo.accessToken}`);
    expect(otherUsersList.body.data).toHaveLength(0);

    const renameAttempt = await request(app)
      .patch(`/api/v1/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${userTwo.accessToken}`)
      .send({ name: "Hijacked" });
    expect(renameAttempt.status).toBe(404);

    const deleteAttempt = await request(app)
      .delete(`/api/v1/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${userTwo.accessToken}`);
    expect(deleteAttempt.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run the integration test to verify it passes**

Unlike a unit test, this integration test exercises the routes/controller/module wiring that
Steps 1-5 of this same task just created, so there's no separate "watch it fail first" step for
it — the wiring it depends on doesn't exist until this task builds it.

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/saved-views/__tests__/saved-views.integration.spec.ts`
Expected: PASS, both tests. (Requires `docker compose up -d postgres redis` running and the test
database migrated per Task 4 Step 3.)

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/saved-views/saved-views.validation.ts apps/server/src/modules/saved-views/saved-views.controller.ts apps/server/src/modules/saved-views/saved-views.routes.ts apps/server/src/modules/saved-views/saved-views.module.ts apps/server/src/routes/v1.router.ts apps/server/src/modules/saved-views/__tests__/saved-views.integration.spec.ts
git commit -m "feat(saved-views): mount GET/POST /saved-views and PATCH/DELETE /saved-views/:id"
```

---

### Task 7: Tenders backend — filter chips + sort wiring

**Files:**
- Create: `apps/server/src/modules/tenders/tenders.filter-columns.ts`
- Modify: `apps/server/src/modules/tenders/tenders.validation.ts`
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`
- Modify: `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`

**Interfaces:**
- Consumes: `buildPrismaFilterWhere`, `FilterableColumnDescriptor` (Task 2); `TENDER_FILTER_FIELDS`,
  `TenderFilterField`, `TENDER_SORT_FIELDS`, `TenderSortField`, `FILTER_OPERATORS` (Task 1).
- Produces: `TENDER_FILTER_COLUMNS`, `TENDER_SORT_COLUMNS` (exported from
  `tenders.filter-columns.ts`); `TenderFilters` gains `filters?`, `sortBy?`, `sortDir?`. Task 17
  (frontend page wiring) relies on `GET /tenders?filters=...&sortBy=...&sortDir=...` working.

- [ ] **Step 1: Write the filter/sort column descriptors**

`apps/server/src/modules/tenders/tenders.filter-columns.ts`:
```ts
import type { Prisma } from "@bmp/database";
import type { TenderFilterField, TenderSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const TENDER_FILTER_COLUMNS: Record<TenderFilterField, FilterableColumnDescriptor> = {
  tenderNumber: { type: "text", prismaPath: ["tenderNumber"] },
  title: { type: "text", prismaPath: ["title"] },
  clientName: { type: "text", prismaPath: ["client", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  priority: { type: "enum", prismaPath: ["priority"] },
  department: { type: "text", prismaPath: ["department"], nullable: true },
  submissionDate: { type: "date", prismaPath: ["submissionDate"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.TenderOrderByWithRelationInput;

// `assigneeCount` is sortable but intentionally absent from TENDER_FILTER_COLUMNS above — Prisma
// supports `orderBy` on a relation's `_count` but has no `where` filter for it.
export const TENDER_SORT_COLUMNS: Record<TenderSortField, OrderByBuilder> = {
  tenderNumber: (dir) => ({ tenderNumber: dir }),
  title: (dir) => ({ title: dir }),
  clientName: (dir) => ({ client: { name: dir } }),
  status: (dir) => ({ status: dir }),
  priority: (dir) => ({ priority: dir }),
  submissionDate: (dir) => ({ submissionDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  assigneeCount: (dir) => ({ assignees: { _count: dir } }),
};
```

- [ ] **Step 2: Extend the validation schema**

In `apps/server/src/modules/tenders/tenders.validation.ts`, add near the top (after the existing
imports):
```ts
import { FILTER_OPERATORS, TENDER_FILTER_FIELDS, TENDER_SORT_FIELDS } from "@bmp/types";
```
(merge into the existing `@bmp/types`/`@bmp/database` import lines rather than duplicating an
import statement, if this file already imports other names from `@bmp/types` — check the file's
current imports before adding a second `import ... from "@bmp/types"` line).

Add these two declarations directly above `listTendersQuerySchema` (`tenders.validation.ts:112`):
```ts
const filterConditionSchema = z.object({
  columnKey: z.enum(TENDER_FILTER_FIELDS),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

const filtersQueryParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(filterConditionSchema).optional());
```

Then extend `listTendersQuerySchema` itself by adding three fields before its closing `});`
(`tenders.validation.ts:112-125`):
```ts
  filters: filtersQueryParam,
  sortBy: z.enum(TENDER_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
```

- [ ] **Step 3: Extend `TenderFilters` and rebuild the repository's `where`/`orderBy`**

In `apps/server/src/modules/tenders/tenders.repository.ts`, add the import:
```ts
import type { FilterCondition, TenderSortField } from "@bmp/types";

import { buildPrismaFilterWhere } from "../../shared/utils/filtering.js";

import { TENDER_FILTER_COLUMNS, TENDER_SORT_COLUMNS } from "./tenders.filter-columns.js";
```

Extend the `TenderFilters` interface (`tenders.repository.ts:85-95`) by adding three fields before
its closing brace:
```ts
  filters?: FilterCondition[];
  sortBy?: TenderSortField;
  sortDir?: "asc" | "desc";
```

Replace the body of `findMany` (`tenders.repository.ts:172-213`) with:
```ts
  async findMany(
    pagination: PaginationParams,
    filters: TenderFilters,
  ): Promise<{ items: TenderListItem[]; totalItems: number }> {
    const baseWhere: Prisma.TenderWhereInput = {
      businessId: filters.businessId,
      status: filters.status,
      kind: filters.kind,
      clientId: filters.clientId,
      priority: filters.priority,
      ...(filters.department ? { department: { contains: filters.department, mode: "insensitive" } } : {}),
      ...(filters.assigneeUserId ? { assignees: { some: { userId: filters.assigneeUserId } } } : {}),
      ...(filters.submissionDateFrom || filters.submissionDateTo
        ? {
            submissionDate: {
              gte: filters.submissionDateFrom,
              lte: filters.submissionDateTo,
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: "insensitive" } },
              { tenderNumber: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const chipWhere = buildPrismaFilterWhere(
      filters.filters ?? [],
      TENDER_FILTER_COLUMNS,
    ) as Prisma.TenderWhereInput;
    const where: Prisma.TenderWhereInput =
      Object.keys(chipWhere).length > 0 ? { AND: [baseWhere, chipWhere] } : baseWhere;

    const orderBy = filters.sortBy
      ? TENDER_SORT_COLUMNS[filters.sortBy](filters.sortDir ?? "asc")
      : ({ createdAt: "desc" } as const);

    const [items, totalItems] = await Promise.all([
      this.prisma.tender.findMany({
        where,
        ...tenderListArgs,
        orderBy,
        ...toSkipTake(pagination),
      }),
      this.prisma.tender.count({ where }),
    ]);

    return { items, totalItems };
  }
```

No changes are needed to `tenders.service.ts` or `tenders.controller.ts` — `listTenders` already
passes `filters: TenderFilters` straight through to the repository, and the controller already
does `{ ...query, businessId: req.user!.businessId }`, which now includes the validated `filters`/
`sortBy`/`sortDir` fields automatically since they're part of `ListTendersQueryParsed`.

- [ ] **Step 4: Add filter/sort integration tests**

In `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`, add a new `describe`
block inside the existing outer `describe("Tender workflow (integration)", ...)`, after the
existing tests and before the closing brace, reusing the outer `app`/`accessToken`/`organizationId`:
```ts
  describe("filtering and sorting", () => {
    let alphaId: string;
    let betaId: string;

    beforeAll(async () => {
      const createAlpha = await request(app)
        .post("/api/v1/tenders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          tenderNumber: `FLT-A-${randomUUID().slice(0, 8)}`,
          title: "Filter Test Alpha",
          department: "PWD",
          clientId: organizationId,
          type: "OPEN",
          category: "ROAD",
          location: "City Center",
          state: "Maharashtra",
          estimatedCost: 1_000_000,
          submissionDate: new Date().toISOString(),
          priority: "HIGH",
        });
      alphaId = createAlpha.body.data.id;

      const createBeta = await request(app)
        .post("/api/v1/tenders")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          tenderNumber: `FLT-B-${randomUUID().slice(0, 8)}`,
          title: "Filter Test Beta",
          department: "PWD",
          clientId: organizationId,
          type: "OPEN",
          category: "ROAD",
          location: "City Center",
          state: "Maharashtra",
          estimatedCost: 1_000_000,
          submissionDate: new Date().toISOString(),
          priority: "LOW",
        });
      betaId = createBeta.body.data.id;
    });

    it("filters tenders by a chip condition on priority", async () => {
      const filters = JSON.stringify([{ columnKey: "priority", operator: "is", value: "HIGH" }]);
      const response = await request(app)
        .get("/api/v1/tenders")
        .query({ filters, pageSize: 100 })
        .set("Authorization", `Bearer ${accessToken}`);
      expect(response.status).toBe(200);
      const ids = response.body.data.items.map((t: { id: string }) => t.id);
      expect(ids).toContain(alphaId);
      expect(ids).not.toContain(betaId);
    });

    it("filters tenders with a text 'contains' condition on title", async () => {
      const filters = JSON.stringify([{ columnKey: "title", operator: "contains", value: "Beta" }]);
      const response = await request(app)
        .get("/api/v1/tenders")
        .query({ filters, pageSize: 100 })
        .set("Authorization", `Bearer ${accessToken}`);
      const ids = response.body.data.items.map((t: { id: string }) => t.id);
      expect(ids).toContain(betaId);
      expect(ids).not.toContain(alphaId);
    });

    it("sorts tenders by title ascending", async () => {
      const response = await request(app)
        .get("/api/v1/tenders")
        .query({ sortBy: "title", sortDir: "asc", pageSize: 100 })
        .set("Authorization", `Bearer ${accessToken}`);
      const titles: string[] = response.body.data.items.map((t: { title: string }) => t.title);
      const alphaIndex = titles.indexOf("Filter Test Alpha");
      const betaIndex = titles.indexOf("Filter Test Beta");
      expect(alphaIndex).toBeGreaterThanOrEqual(0);
      expect(betaIndex).toBeGreaterThan(alphaIndex);
    });
  });
```
(The outer `afterAll`'s existing `prisma.tender.deleteMany({ where: { createdById: userId } })`
already cleans these up — no new cleanup needed.)

- [ ] **Step 5: Run the tenders integration tests**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.integration.spec.ts`
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/tenders/tenders.filter-columns.ts apps/server/src/modules/tenders/tenders.validation.ts apps/server/src/modules/tenders/tenders.repository.ts apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts
git commit -m "feat(tenders): support chip-based filters and column sorting on GET /tenders"
```

---

### Task 8: Tenders export endpoint

**Files:**
- Modify: `apps/server/src/config/constants.ts`
- Modify: `apps/server/src/modules/tenders/tenders.validation.ts`
- Modify: `apps/server/src/modules/tenders/tenders.mapper.ts`
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`
- Modify: `apps/server/src/modules/tenders/tenders.controller.ts`
- Modify: `apps/server/src/modules/tenders/tenders.routes.ts`
- Modify: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`
- Modify: `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`

**Interfaces:**
- Consumes: `exportTableToXlsx`, `exportTableToCsv`, `ExportableTable` (Task 3); `TenderFilters`
  with `filters`/`sortBy`/`sortDir` (Task 7).
- Produces: `GET /tenders/export?format=csv|xlsx&scope=view|all&columns=...&<list params>`. No
  other task consumes this directly — it's a terminal endpoint the frontend (Task 17) calls.

- [ ] **Step 1: Add the row cap constant**

In `apps/server/src/config/constants.ts`, add:
```ts
export const EXPORT_MAX_ROWS = 50_000;
```

- [ ] **Step 2: Add the export query schema**

In `apps/server/src/modules/tenders/tenders.validation.ts`, add after `listTendersQuerySchema`:
```ts
export const exportTendersQuerySchema = listTendersQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportTendersQueryParsed = z.infer<typeof exportTendersQuerySchema>;
```

- [ ] **Step 3: Add the export table builder to the mapper**

In `apps/server/src/modules/tenders/tenders.mapper.ts`, add the import:
```ts
import type { ExportableTable } from "../../shared/utils/table-export.js";
```
And add these two exports (`TenderListItemDto` is already imported/used elsewhere in this file —
reuse the existing import rather than adding a second one):
```ts
// Keep this in exact sync with apps/web/src/components/tenders/tender-column-registry.ts's
// TENDER_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const TENDER_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "tenderNumber", header: "Tender #" },
  { key: "title", header: "Title" },
  { key: "clientName", header: "Client" },
  { key: "status", header: "Status" },
  { key: "priority", header: "Priority" },
  { key: "department", header: "Department" },
  { key: "submissionDate", header: "Submission Date" },
  { key: "assigneeCount", header: "Assignees" },
];

function tenderExportRow(tender: TenderListItemDto): Record<string, string | number> {
  return {
    tenderNumber: tender.tenderNumber,
    title: tender.title,
    clientName: tender.client.name,
    status: tender.status,
    priority: tender.priority,
    department: tender.department ?? "",
    submissionDate: tender.submissionDate ? tender.submissionDate.slice(0, 10) : "",
    assigneeCount: tender.assigneeCount,
  };
}

export function buildTenderExportTable(tenders: TenderListItemDto[], columnKeys: string[]): ExportableTable {
  const columns = TENDER_EXPORT_COLUMNS.filter((column) => columnKeys.includes(column.key));
  const rows = tenders.map((tender) => {
    const fullRow = tenderExportRow(tender);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Tenders", columns, rows };
}

export const TENDER_EXPORT_COLUMN_KEYS = TENDER_EXPORT_COLUMNS.map((column) => column.key);
```

- [ ] **Step 4: Write the failing service unit test for the row cap**

In `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`, add a `findManyResult`
field to `FakeTendersRepository` (near its `tenders` map, `tenders.service.spec.ts:72`):
```ts
  findManyResult: { items: TenderListItem[]; totalItems: number } = { items: [], totalItems: 0 };
```
(add `TenderListItem` to the file's existing `import type { ... } from "../tenders.repository.js"`
line) and change its `findMany` method (`tenders.service.spec.ts:83-85`) to:
```ts
  async findMany() {
    return this.findManyResult;
  }
```

Then add a new nested `describe` inside the existing `describe("TendersService", ...)` block,
after the other tests:
```ts
  describe("exportTenders", () => {
    it("throws BadRequestError when more than EXPORT_MAX_ROWS rows match scope=all", async () => {
      tendersRepository.findManyResult = { items: [], totalItems: 50_001 };
      await expect(
        service.exportTenders({ businessId: BUSINESS_ID }, "all", { page: 1, pageSize: 20 }),
      ).rejects.toThrow(BadRequestError);
    });

    it("does not cap scope=view even with a large totalItems", async () => {
      tendersRepository.findManyResult = { items: [], totalItems: 50_001 };
      await expect(
        service.exportTenders({ businessId: BUSINESS_ID }, "view", { page: 1, pageSize: 20 }),
      ).resolves.toEqual([]);
    });
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.service.spec.ts`
Expected: FAIL — `service.exportTenders is not a function`.

- [ ] **Step 6: Add `exportTenders` to the service**

In `apps/server/src/modules/tenders/tenders.service.ts`, add the import:
```ts
import { EXPORT_MAX_ROWS } from "../../config/constants.js";
```
(`BadRequestError` is already imported in this file, used by `create()`.) Add the method to the
`TendersService` class, near `listTenders`:
```ts
  async exportTenders(
    filters: TenderFilters,
    scope: "view" | "all",
    viewPagination: PaginationParams,
  ): Promise<TenderListItemDto[]> {
    const pagination = scope === "view" ? viewPagination : { page: 1, pageSize: EXPORT_MAX_ROWS };
    const { items, totalItems } = await this.tendersRepository.findMany(pagination, filters);
    if (scope === "all" && totalItems > EXPORT_MAX_ROWS) {
      throw new BadRequestError(
        `Narrow your filters — more than ${EXPORT_MAX_ROWS} rows match your current filters.`,
      );
    }
    return items.map(toTenderListItemDto);
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.service.spec.ts`
Expected: PASS, including the 2 new tests.

- [ ] **Step 8: Add the controller handler**

In `apps/server/src/modules/tenders/tenders.controller.ts`, add the import:
```ts
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { buildTenderExportTable, TENDER_EXPORT_COLUMN_KEYS } from "./tenders.mapper.js";
```
(add `ExportTendersQueryParsed` to the file's existing `import type { ... } from
"./tenders.validation.js"` line). Add the handler to the `TendersController` class, near `list`:
```ts
  exportTenders = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportTendersQueryParsed;
    const pagination = resolvePagination(query);
    const items = await this.tendersService.exportTenders(
      { ...query, businessId: req.user!.businessId },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? TENDER_EXPORT_COLUMN_KEYS;
    const table = buildTenderExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="tenders-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="tenders-export-${date}.csv"`);
    res.send(buffer);
  });
```

- [ ] **Step 9: Add the route**

In `apps/server/src/modules/tenders/tenders.routes.ts`, add `exportTendersQuerySchema` to the
existing `import { ... } from "./tenders.validation.js"` line, and add the route right after
`/dashboard-stats` and before the `/:id` block (`tenders.routes.ts:106`, i.e. between the
`dashboard-stats` route registration and the `/{id}` JSDoc comment) — registering `/export` before
`/:id` is required, otherwise Express would match `GET /tenders/export` as `GET /tenders/:id` with
`id="export"`:
```ts
  /**
   * @openapi
   * /tenders/export:
   *   get:
   *     tags: [Tenders]
   *     summary: Export tenders matching the current filters as CSV or XLSX
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [csv, xlsx] }
   *       - in: query
   *         name: scope
   *         required: true
   *         schema: { type: string, enum: [view, all] }
   *     responses:
   *       200: { description: File download }
   */
  router.get(
    "/export",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    validate(exportTendersQuerySchema, "query"),
    controller.exportTenders,
  );
```

- [ ] **Step 10: Add export integration tests**

In `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`, add another nested
`describe` alongside `"filtering and sorting"`:
```ts
  describe("export", () => {
    it("exports the current view as CSV", async () => {
      const response = await request(app)
        .get("/api/v1/tenders/export")
        .query({ format: "csv", scope: "view", page: 1, pageSize: 20 })
        .set("Authorization", `Bearer ${accessToken}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("text/csv");
      expect(response.text).toContain("Tender #");
    });

    it("exports all matching rows as XLSX", async () => {
      const response = await request(app)
        .get("/api/v1/tenders/export")
        .query({ format: "xlsx", scope: "all" })
        .set("Authorization", `Bearer ${accessToken}`);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("spreadsheetml");
    });
  });
```

- [ ] **Step 11: Run the full tenders test files**

Run:
```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.service.spec.ts src/modules/tenders/__tests__/tenders.integration.spec.ts
```
Expected: PASS, all tests.

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add apps/server/src/config/constants.ts apps/server/src/modules/tenders/tenders.validation.ts apps/server/src/modules/tenders/tenders.mapper.ts apps/server/src/modules/tenders/tenders.service.ts apps/server/src/modules/tenders/tenders.controller.ts apps/server/src/modules/tenders/tenders.routes.ts apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts
git commit -m "feat(tenders): add GET /tenders/export (CSV/XLSX, current-view or all-matching)"
```

---

### Task 9: `packages/ui` — generic Popover primitive

**Files:**
- Create: `packages/ui/src/components/popover.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`. Tasks 11, 13 consume
  these.

- [ ] **Step 1: Write the component**

`packages/ui/src/components/popover.tsx` (mirrors the exact `PopoverPrimitive` usage/className
convention already used inline inside `combobox.tsx` and `multi-select.tsx`, extracted into a
reusable primitive since two more components now need the same popover shell):
```tsx
"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "../lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[16rem] rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add (alongside the other component exports, e.g. after
`export * from "./components/pagination";`):
```ts
export * from "./components/popover";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/popover.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add a generic Popover primitive"
```

---

### Task 10: `packages/ui` — promote `SortableHeader`

**Files:**
- Create: `packages/ui/src/components/sortable-header.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `SortableHeader<TData>({ column, label })`. Task 16 (`tender-column-registry.ts`)
  consumes this.

- [ ] **Step 1: Write the component**

`packages/ui/src/components/sortable-header.tsx` (identical logic to Items' page-local
`SortHeader`, `apps/web/src/app/(dashboard)/items/page.tsx:46-64`, made generic over `TData` so
every page can share one implementation instead of re-declaring it):
```tsx
"use client";

import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export interface SortableHeaderProps<TData> {
  column: Column<TData, unknown>;
  label: string;
}

export function SortableHeader<TData>({ column, label }: SortableHeaderProps<TData>) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add:
```ts
export * from "./components/sortable-header";
```

Note: Items' page-local `SortHeader` is deliberately left as-is in this task (out of scope for the
Tenders pilot to touch other pages) — the follow-up rollout plan can switch Items over to this
promoted version.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/sortable-header.tsx packages/ui/src/index.ts
git commit -m "feat(ui): promote Items' SortHeader into a generic SortableHeader component"
```

---

### Task 11: `packages/ui` — filter types + `AddFilterPopover`

**Files:**
- Create: `packages/ui/src/lib/filterable-column.ts`
- Create: `packages/ui/src/components/add-filter-popover.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Popover`/`PopoverTrigger`/`PopoverContent` (Task 9); existing `Button`, `Input`,
  `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`, `MultiSelect`.
- Produces (from `lib/filterable-column.ts`): `FilterColumnType`, `FilterOperator`,
  `FilterableColumnDef`, `FilterCondition` (packages/ui's own local copies — see Global
  Constraints), `operatorsForColumn(column)`, `operatorLabel(operator)`. Produces (from
  `add-filter-popover.tsx`): `AddFilterPopover`. Tasks 12, 16, 17 consume all of these.

- [ ] **Step 1: Write the local filter types and operator helpers**

`packages/ui/src/lib/filterable-column.ts`:
```ts
// packages/ui stays domain-agnostic and free of a @bmp/types dependency (see CLAUDE.md's "no
// tender/user strings in packages/ui" rule). These mirror the same literal unions independently
// declared in @bmp/types' filtering.ts — structurally identical, so a caller passing a real
// FilterCondition from @bmp/types satisfies this file's types with no casting needed.
export type FilterColumnType = "text" | "number" | "date" | "enum" | "boolean";

export type FilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "has_any_value"
  | "gt"
  | "lt"
  | "between"
  | "before"
  | "after"
  | "any_of";

export interface FilterableColumnDef {
  key: string;
  label: string;
  type: FilterColumnType;
  nullable?: boolean;
  enumOptions?: { value: string; label: string }[];
}

export interface FilterCondition {
  columnKey: string;
  operator: FilterOperator;
  value?: string | number | (string | number)[];
}

const OPERATORS_BY_TYPE: Record<FilterColumnType, FilterOperator[]> = {
  text: ["is", "is_not", "contains", "has_any_value"],
  number: ["is", "gt", "lt", "between", "has_any_value"],
  date: ["is", "before", "after", "between", "has_any_value"],
  enum: ["is", "is_not", "any_of", "has_any_value"],
  boolean: ["is"],
};

export function operatorsForColumn(column: FilterableColumnDef): FilterOperator[] {
  const operators = OPERATORS_BY_TYPE[column.type];
  return column.nullable ? operators : operators.filter((op) => op !== "has_any_value");
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  has_any_value: "has any value",
  gt: "is greater than",
  lt: "is less than",
  between: "is between",
  before: "is before",
  after: "is after",
  any_of: "is any of",
};

export function operatorLabel(operator: FilterOperator): string {
  return OPERATOR_LABELS[operator];
}
```

- [ ] **Step 2: Write `AddFilterPopover`**

`packages/ui/src/components/add-filter-popover.tsx`:
```tsx
"use client";

import { Circle, CircleDot } from "lucide-react";
import * as React from "react";

import { operatorLabel, operatorsForColumn } from "../lib/filterable-column";
import type { FilterableColumnDef, FilterCondition, FilterOperator } from "../lib/filterable-column";

import { Button } from "./button";
import { Input } from "./input";
import { MultiSelect } from "./multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface AddFilterPopoverProps {
  columns: FilterableColumnDef[];
  /** Present when editing an existing chip; omitted when adding a new one. */
  initialCondition?: FilterCondition | null;
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (condition: FilterCondition) => void;
}

function defaultOperator(column: FilterableColumnDef): FilterOperator {
  return operatorsForColumn(column)[0]!;
}

export function AddFilterPopover({
  columns,
  initialCondition,
  trigger,
  open,
  onOpenChange,
  onApply,
}: AddFilterPopoverProps) {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(initialCondition?.columnKey ?? null);
  const [operator, setOperator] = React.useState<FilterOperator | null>(initialCondition?.operator ?? null);
  const [value, setValue] = React.useState<FilterCondition["value"]>(initialCondition?.value ?? "");

  React.useEffect(() => {
    if (!open) return;
    setSelectedKey(initialCondition?.columnKey ?? null);
    setOperator(initialCondition?.operator ?? null);
    setValue(initialCondition?.value ?? "");
  }, [open, initialCondition]);

  const selectedColumn = columns.find((column) => column.key === selectedKey) ?? null;

  function pickColumn(column: FilterableColumnDef) {
    setSelectedKey(column.key);
    const op = defaultOperator(column);
    setOperator(op);
    setValue(op === "between" ? ["", ""] : "");
  }

  function handleApply() {
    if (!selectedColumn || !operator) return;
    onApply({ columnKey: selectedColumn.key, operator, value });
    onOpenChange(false);
  }

  function renderValueInput() {
    if (!selectedColumn || !operator || operator === "has_any_value") return null;

    if (operator === "between") {
      const [min, max] = Array.isArray(value) ? value : ["", ""];
      const inputType = selectedColumn.type === "date" ? "date" : "number";
      return (
        <div className="flex items-center gap-2">
          <Input type={inputType} value={min ?? ""} onChange={(e) => setValue([e.target.value, max ?? ""])} />
          <span className="text-muted-foreground">and</span>
          <Input type={inputType} value={max ?? ""} onChange={(e) => setValue([min ?? "", e.target.value])} />
        </div>
      );
    }

    if (selectedColumn.type === "enum" && operator === "any_of") {
      return (
        <MultiSelect
          options={selectedColumn.enumOptions ?? []}
          selected={Array.isArray(value) ? (value as string[]) : []}
          onChange={(selected) => setValue(selected)}
        />
      );
    }

    if (selectedColumn.type === "enum") {
      return (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => setValue(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a value" />
          </SelectTrigger>
          <SelectContent>
            {(selectedColumn.enumOptions ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    const inputType = selectedColumn.type === "date" ? "date" : selectedColumn.type === "number" ? "number" : "text";
    return (
      <Input
        type={inputType}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(e) => setValue(selectedColumn.type === "number" ? Number(e.target.value) : e.target.value)}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[28rem] p-0">
        <div className="flex">
          <div className="w-40 border-r p-1">
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                onClick={() => pickColumn(column)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  selectedKey === column.key ? "bg-accent font-medium" : ""
                }`}
              >
                {column.label}
              </button>
            ))}
          </div>
          <div className="flex-1 space-y-3 p-3">
            {selectedColumn ? (
              <>
                <div className="space-y-1">
                  {operatorsForColumn(selectedColumn).map((op) => (
                    <button
                      key={op}
                      type="button"
                      role="radio"
                      aria-checked={operator === op}
                      onClick={() => setOperator(op)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      {operator === op ? (
                        <CircleDot className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {operatorLabel(op)}
                    </button>
                  ))}
                </div>
                {renderValueInput()}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={handleApply} disabled={!operator}>
                    Apply Filter
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pick a column to filter by.</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Export both**

In `packages/ui/src/index.ts`, add:
```ts
export * from "./lib/filterable-column";
export * from "./components/add-filter-popover";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/filterable-column.ts packages/ui/src/components/add-filter-popover.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add AddFilterPopover — column, operator, and value picker for the filter chip builder"
```

---

### Task 12: `packages/ui` — `ActiveFilterChips`

**Files:**
- Create: `packages/ui/src/components/active-filter-chips.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `AddFilterPopover`, `FilterableColumnDef`, `FilterCondition`, `operatorLabel` (Task 11).
- Produces: `ActiveFilterChips`. Task 17 consumes this.

- [ ] **Step 1: Write the component**

`packages/ui/src/components/active-filter-chips.tsx`:
```tsx
"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { operatorLabel } from "../lib/filterable-column";
import type { FilterableColumnDef, FilterCondition } from "../lib/filterable-column";

import { AddFilterPopover } from "./add-filter-popover";
import { Button } from "./button";

function valueLabel(column: FilterableColumnDef, condition: FilterCondition): string {
  if (condition.operator === "has_any_value") return "";
  if (Array.isArray(condition.value)) {
    if (condition.operator === "between") return `${condition.value[0]} and ${condition.value[1]}`;
    if (column.enumOptions) {
      const labels = condition.value.map(
        (v) => column.enumOptions!.find((option) => option.value === v)?.label ?? String(v),
      );
      return labels.join(", ");
    }
    return condition.value.join(", ");
  }
  if (column.enumOptions) {
    return column.enumOptions.find((option) => option.value === condition.value)?.label ?? String(condition.value ?? "");
  }
  return String(condition.value ?? "");
}

export interface ActiveFilterChipsProps {
  columns: FilterableColumnDef[];
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
}

export function ActiveFilterChips({ columns, conditions, onChange }: ActiveFilterChipsProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);

  function removeAt(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function applyEdit(condition: FilterCondition) {
    if (editingIndex === null) return;
    const next = [...conditions];
    next[editingIndex] = condition;
    onChange(next);
    setEditingIndex(null);
  }

  function applyNew(condition: FilterCondition) {
    onChange([...conditions, condition]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {conditions.map((condition, index) => {
        const column = columns.find((c) => c.key === condition.columnKey);
        if (!column) return null;
        return (
          <AddFilterPopover
            key={`${condition.columnKey}-${index}`}
            columns={columns}
            initialCondition={condition}
            open={editingIndex === index}
            onOpenChange={(open) => setEditingIndex(open ? index : null)}
            onApply={applyEdit}
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm hover:bg-accent"
              >
                <span>
                  {column.label} {operatorLabel(condition.operator)} {valueLabel(column, condition)}
                </span>
                <X
                  className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAt(index);
                  }}
                />
              </button>
            }
          />
        );
      })}
      <AddFilterPopover
        columns={columns}
        open={addOpen}
        onOpenChange={setAddOpen}
        onApply={applyNew}
        trigger={
          <Button type="button" variant="outline" size="icon" className="h-8 w-8">
            <Plus className="h-4 w-4" />
          </Button>
        }
      />
      {conditions.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear all
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add:
```ts
export * from "./components/active-filter-chips";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/active-filter-chips.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add ActiveFilterChips — the filter chip row with edit, remove, and clear-all"
```

---

### Task 13: `packages/ui` — `ColumnPicker`

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/components/column-picker.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Popover`/`PopoverTrigger`/`PopoverContent` (Task 9), existing `Checkbox`, `Button`.
- Produces: `ColumnPicker`. Task 17 consumes it.

Note: `DataTable` (`packages/ui/src/components/data-table.tsx`) is NOT modified by this task.
TanStack Table's native `columnVisibility`/`columnOrder` state was the spec's original sketch, but
Task 16/17's actual mechanism is simpler and doesn't need it: `buildTenderColumnDefs({visibleKeys,
order, ...})` (Task 16) filters and reorders the `ColumnDef[]` array itself before it ever reaches
`DataTable`, so `DataTable` never needs to know about visibility/order at all — it just renders
whatever columns array it's handed, exactly as it does today. Wiring TanStack's own visibility/
order state into `DataTable` in addition would be dead code no page in this plan calls.

- [ ] **Step 1: Add the drag-reorder dependency**

Run:
```bash
pnpm --filter @bmp/ui add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
Expected: `packages/ui/package.json`'s `dependencies` gains the three packages, `pnpm-lock.yaml`
updates. This is the only new runtime dependency this plan introduces — nothing in the repo does
drag-and-drop today, and `@dnd-kit` is the current maintained standard (`react-beautiful-dnd`, the
older alternative, is unmaintained upstream).

- [ ] **Step 2: Write `ColumnPicker`**

`packages/ui/src/components/column-picker.tsx`:
```tsx
"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ColumnPickerColumn {
  key: string;
  label: string;
}

export interface ColumnPickerProps {
  columns: ColumnPickerColumn[];
  visibleKeys: string[];
  order: string[];
  defaultVisibleKeys: string[];
  defaultOrder: string[];
  onChange: (next: { visibleKeys: string[]; order: string[] }) => void;
}

function SortableRow({
  column,
  checked,
  onToggle,
}: {
  column: ColumnPickerColumn;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
      <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox checked={checked} onCheckedChange={(value) => onToggle(value === true)} />
      <span className="text-sm">{column.label}</span>
    </div>
  );
}

export function ColumnPicker({
  columns,
  visibleKeys,
  order,
  defaultVisibleKeys,
  defaultOrder,
  onChange,
}: ColumnPickerProps) {
  const [open, setOpen] = React.useState(false);
  const sensors = useSensors(useSensor(PointerSensor));
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const orderedColumns = order
    .map((key) => columnByKey.get(key))
    .filter((column): column is ColumnPickerColumn => Boolean(column));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    const next = [...order];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, String(active.id));
    onChange({ visibleKeys, order: next });
  }

  function toggle(key: string, checked: boolean) {
    const next = checked ? [...visibleKeys, key] : visibleKeys.filter((k) => k !== key);
    onChange({ visibleKeys: next, order });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal className="mr-2 h-4 w-4" /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {orderedColumns.map((column) => (
                <SortableRow
                  key={column.key}
                  column={column}
                  checked={visibleKeys.includes(column.key)}
                  onToggle={(checked) => toggle(column.key, checked)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => onChange({ visibleKeys: defaultVisibleKeys, order: defaultOrder })}
        >
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Export `ColumnPicker`**

In `packages/ui/src/index.ts`, add:
```ts
export * from "./components/column-picker";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml packages/ui/src/components/column-picker.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add ColumnPicker (drag-reorder via dnd-kit)"
```

---

### Task 14: `packages/ui` — `SavedViewTabs`

**Files:**
- Create: `packages/ui/src/components/saved-view-tabs.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: existing `Tabs`/`TabsList`/`TabsTrigger`, `DropdownMenu`/`DropdownMenuTrigger`/
  `DropdownMenuContent`/`DropdownMenuItem`, `Input`, `Button`.
- Produces: `SavedViewTabs`, `DEFAULT_VIEW_ID`. Task 17 consumes both.

- [ ] **Step 1: Write the component**

`packages/ui/src/components/saved-view-tabs.tsx`:
```tsx
"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { Input } from "./input";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

export const DEFAULT_VIEW_ID = "__default__";

export interface SavedViewTabItem {
  id: string;
  name: string;
}

export interface SavedViewTabsProps {
  views: SavedViewTabItem[];
  activeId: string;
  hasUnsavedChanges: boolean;
  onSelect: (id: string) => void;
  onSaveNew: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SavedViewTabs({
  views,
  activeId,
  hasUnsavedChanges,
  onSelect,
  onSaveNew,
  onRename,
  onUpdate,
  onDelete,
}: SavedViewTabsProps) {
  const [namingOpen, setNamingOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  function submitNewView() {
    if (!draftName.trim()) return;
    onSaveNew(draftName.trim());
    setDraftName("");
    setNamingOpen(false);
  }

  function submitRename() {
    if (!renamingId || !draftName.trim()) return;
    onRename(renamingId, draftName.trim());
    setDraftName("");
    setRenamingId(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={activeId} onValueChange={onSelect}>
        <TabsList>
          <TabsTrigger value={DEFAULT_VIEW_ID}>Default</TabsTrigger>
          {views.map((view) => (
            <div key={view.id} className="flex items-center">
              <TabsTrigger value={view.id}>{view.name}</TabsTrigger>
              {activeId === view.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenamingId(view.id);
                        setDraftName(view.name);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    {hasUnsavedChanges && (
                      <DropdownMenuItem onSelect={() => onUpdate(view.id)}>
                        Update with current filters
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => onDelete(view.id)} className="text-destructive">
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </TabsList>
      </Tabs>

      {renamingId ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            className="h-8 w-40"
          />
          <Button type="button" size="sm" onClick={submitRename}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
            Cancel
          </Button>
        </div>
      ) : namingOpen ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            placeholder="View name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewView()}
            className="h-8 w-40"
          />
          <Button type="button" size="sm" onClick={submitNewView}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNamingOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        hasUnsavedChanges && (
          <Button type="button" variant="outline" size="sm" onClick={() => setNamingOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Save as view
          </Button>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add:
```ts
export * from "./components/saved-view-tabs";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/saved-view-tabs.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add SavedViewTabs — Default tab plus the user's saved views with rename/update/delete"
```

---

### Task 15: `apps/web` — `use-saved-views.ts` hooks

**Files:**
- Create: `apps/web/src/hooks/use-saved-views.ts`

**Interfaces:**
- Consumes: `SavedViewDto`, `CreateSavedViewInput`, `UpdateSavedViewInput` (Task 1); the
  `/saved-views` HTTP contract (Task 6).
- Produces: `useSavedViews(pageKey)`, `useCreateSavedView()`, `useUpdateSavedView(pageKey)`,
  `useDeleteSavedView(pageKey)`. Task 17 consumes all four.

- [ ] **Step 1: Write the hooks**

`apps/web/src/hooks/use-saved-views.ts`:
```ts
"use client";

import type { ApiResponse, CreateSavedViewInput, SavedViewDto, UpdateSavedViewInput } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useSavedViews(pageKey: string) {
  return useQuery({
    queryKey: ["saved-views", pageKey],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SavedViewDto[]>>("/saved-views", {
        params: { pageKey },
      });
      return unwrap(response.data);
    },
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSavedViewInput) => {
      const response = await apiClient.post<ApiResponse<SavedViewDto>>("/saved-views", input);
      return unwrap(response.data);
    },
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", view.pageKey] });
    },
  });
}

export function useUpdateSavedView(pageKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateSavedViewInput }) => {
      const response = await apiClient.patch<ApiResponse<SavedViewDto>>(`/saved-views/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", pageKey] });
    },
  });
}

export function useDeleteSavedView(pageKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/saved-views/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", pageKey] });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: no errors. (Stop the dev server first if it's running — typecheck and `next dev` racing
on `.next` produces bogus `TS6053` errors, per this repo's known gotcha.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-saved-views.ts
git commit -m "feat(web): add useSavedViews/useCreateSavedView/useUpdateSavedView/useDeleteSavedView hooks"
```

---

### Task 16: `apps/web` — `tender-column-registry.ts`

**Files:**
- Create: `apps/web/src/components/tenders/tender-column-registry.ts`
- Delete: `apps/web/src/components/tenders/tender-table-columns.tsx`

**Interfaces:**
- Consumes: `FilterableColumnDef`, `SortableHeader` (Task 10, 11); `TENDER_STATUSES`,
  `TENDER_STATUS_LABELS`, `TENDER_PRIORITIES` (already in `@bmp/types`).
- Produces: `TenderColumnConfig`, `TENDER_COLUMNS`, `TENDER_DEFAULT_VISIBLE_KEYS`,
  `TENDER_DEFAULT_ORDER`, `buildTenderColumnDefs({ visibleKeys, order, canGenerateDocument })`.
  Task 17 (page wiring) consumes all four.

- [ ] **Step 1: Delete the old columns file**

`tender-table-columns.tsx`'s only importer is `tenders/page.tsx`, updated in Task 17 — delete this
file now:
```bash
git rm apps/web/src/components/tenders/tender-table-columns.tsx
```

- [ ] **Step 2: Write the registry**

`apps/web/src/components/tenders/tender-column-registry.ts`:
```tsx
"use client";

import type { TenderListItemDto } from "@bmp/types";
import { TENDER_PRIORITIES, TENDER_STATUS_LABELS, TENDER_STATUSES } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";

export interface TenderColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<TenderListItemDto>["cell"];
}

export const TENDER_COLUMNS: TenderColumnConfig[] = [
  {
    key: "tenderNumber",
    label: "Tender #",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/tenders/${row.original.id}`} className="font-medium hover:underline">
        {row.original.tenderNumber}
      </Link>
    ),
  },
  {
    key: "title",
    label: "Title",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span>,
  },
  {
    key: "clientName",
    label: "Client",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.client.name,
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: TENDER_STATUSES.map((s) => ({ value: s, label: TENDER_STATUS_LABELS[s] })),
    cell: ({ row }) => (
      <Badge variant={tenderStatusBadgeVariant(row.original.status)}>
        {TENDER_STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: TENDER_PRIORITIES.map((p) => ({ value: p, label: p })),
    cell: ({ row }) => (
      <Badge variant={tenderPriorityBadgeVariant(row.original.priority)}>{row.original.priority}</Badge>
    ),
  },
  {
    key: "department",
    label: "Department",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.department ?? "-",
  },
  {
    key: "submissionDate",
    label: "Submission Date",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => formatDate(row.original.submissionDate),
  },
  {
    key: "assigneeCount",
    label: "Assignees",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.assigneeCount,
  },
];

export const TENDER_DEFAULT_VISIBLE_KEYS = TENDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const TENDER_DEFAULT_ORDER = TENDER_COLUMNS.map((c) => c.key);

export function buildTenderColumnDefs({
  visibleKeys,
  order,
  canGenerateDocument,
}: {
  visibleKeys: string[];
  order: string[];
  canGenerateDocument: boolean;
}): ColumnDef<TenderListItemDto>[] {
  const configByKey = new Map(TENDER_COLUMNS.map((c) => [c.key, c]));
  const columns: ColumnDef<TenderListItemDto>[] = order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is TenderColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));

  if (canGenerateDocument) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TenderDownloadMenu
            tenderId={row.original.id}
            tenderNumber={row.original.tenderNumber}
            size="sm"
            iconOnly
          />
        </div>
      ),
    });
  }

  return columns;
}
```
Note: no `accessorKey`/`accessorFn` on any column — every column already has a fully custom `cell`
that reads `row.original` directly, and `DataTable` is `manualSorting: true` with no
`getFilteredRowModel`/`getSortedRowModel`, so nothing ever calls `row.getValue()` for these
columns. `column.id` (from each `ColumnDef`'s `id`) is what appears in `SortingState` when a
header is clicked — that's what Task 17 reads as `sortBy`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: FAIL at this point — `tenders/page.tsx` still imports the now-deleted
`buildTenderTableColumns`. This is expected; Task 17 fixes it. Confirm the failure is exactly that
one missing-import error and nothing else in this new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/tenders/tender-column-registry.ts apps/web/src/components/tenders/tender-table-columns.tsx
git commit -m "feat(web): replace tender-table-columns.tsx with a registry driving columns, filters, and sort"
```

---

### Task 17: `apps/web` — wire the Tenders page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/page.tsx`

**Interfaces:**
- Consumes: everything produced by Tasks 1, 7, 8, 11-16.
- Produces: the finished Tenders page. Consumed by Task 18 (browser verification) only.

- [ ] **Step 1: Rewrite the page**

Replace the full contents of `apps/web/src/app/(dashboard)/tenders/page.tsx`:
```tsx
"use client";

import {
  TENDER_KIND_LABELS,
  TENDER_KINDS,
  TENDER_STATUS_LABELS,
  TENDER_STATUSES,
  TENDER_PRIORITIES,
  type FilterCondition,
  type TenderKind,
  type TenderPriority,
  type TenderSortField,
  type TenderStatus,
} from "@bmp/types";
import {
  ActiveFilterChips,
  Button,
  ColumnPicker,
  DataTable,
  DEFAULT_VIEW_ID,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  SavedViewTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, FilePlus, FileText, SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  buildTenderColumnDefs,
  TENDER_COLUMNS,
  TENDER_DEFAULT_ORDER,
  TENDER_DEFAULT_VISIBLE_KEYS,
} from "@/components/tenders/tender-column-registry";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { useTenders } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { downloadFile } from "@/lib/download";
import { hasPermission } from "@/lib/permissions";

const PAGE_KEY = "tenders";
const FILTERABLE_COLUMNS = TENDER_COLUMNS.filter((c) => c.filterable);
const PICKER_COLUMNS = TENDER_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export default function TendersPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>(() => {
    const fromUrl = searchParams.get("status");
    return fromUrl && (TENDER_STATUSES as readonly string[]).includes(fromUrl) ? fromUrl : "";
  });
  const [priority, setPriority] = useState<string>("");
  const [kind, setKind] = useState<TenderKind>("TENDER");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(TENDER_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(TENDER_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as TenderSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const tendersQuery = useTenders({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: (status || undefined) as TenderStatus | undefined,
    priority: (priority || undefined) as TenderPriority | undefined,
    kind,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  const canCreate = hasPermission(roleName, "tenders:create");
  const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");
  const hasActiveFilters = Boolean(debouncedSearch || status || priority || conditions.length > 0);

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(TENDER_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(TENDER_DEFAULT_ORDER);
      setSorting([]);
      return;
    }
    const view = savedViews.find((v) => v.id === id);
    if (!view) return;
    setConditions(view.filters);
    setVisibleKeys(view.visibleColumns);
    setColumnOrder(view.columnOrder);
    setSorting(view.sortBy ? [{ id: view.sortBy, desc: view.sortDir === "desc" }] : []);
  }

  const activeView = savedViews.find((v) => v.id === activeViewId) ?? null;
  const hasUnsavedChanges =
    activeViewId === DEFAULT_VIEW_ID
      ? conditions.length > 0 ||
        visibleKeys.join(",") !== TENDER_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== TENDER_DEFAULT_ORDER.join(",") ||
        sorting.length > 0
      : !activeView ||
        JSON.stringify(activeView.filters) !== JSON.stringify(conditions) ||
        activeView.visibleColumns.join(",") !== visibleKeys.join(",") ||
        activeView.columnOrder.join(",") !== columnOrder.join(",") ||
        activeView.sortBy !== sortBy ||
        (activeView.sortDir ?? undefined) !== sortDir;

  async function saveCurrentAsNewView(name: string) {
    try {
      const created = await createSavedView.mutateAsync({
        pageKey: PAGE_KEY,
        name,
        filters: conditions,
        visibleColumns: visibleKeys,
        columnOrder,
        sortBy,
        sortDir,
      });
      setActiveViewId(created.id);
      toast({ title: "View saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function updateActiveView(id: string) {
    try {
      await updateSavedView.mutateAsync({
        id,
        input: { filters: conditions, visibleColumns: visibleKeys, columnOrder, sortBy, sortDir },
      });
      toast({ title: "View updated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function renameView(id: string, name: string) {
    try {
      await updateSavedView.mutateAsync({ id, input: { name } });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not rename view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function deleteView(id: string) {
    try {
      await deleteSavedView.mutateAsync(id);
      if (activeViewId === id) applySavedView(DEFAULT_VIEW_ID);
      toast({ title: "View deleted" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleExport(format: "csv" | "xlsx", scope: "view" | "all") {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("scope", scope);
    params.set("page", String(pagination.pageIndex + 1));
    params.set("pageSize", String(pagination.pageSize));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    params.set("kind", kind);
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/tenders/export?${params.toString()}`, `tenders-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const newTenderButton = (
    <Button asChild>
      <Link href="/tenders/new">
        <FilePlus className="mr-2 h-4 w-4" /> New Tender
      </Link>
    </Button>
  );

  const columns = useMemo(
    () => buildTenderColumnDefs({ visibleKeys, order: columnOrder, canGenerateDocument }),
    [visibleKeys, columnOrder, canGenerateDocument],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenders"
        description="Track tenders from draft through award."
        actions={canCreate ? newTenderButton : undefined}
      />

      <SavedViewTabs
        views={savedViews.map((v) => ({ id: v.id, name: v.name }))}
        activeId={activeViewId}
        hasUnsavedChanges={hasUnsavedChanges}
        onSelect={applySavedView}
        onSaveNew={saveCurrentAsNewView}
        onRename={renameView}
        onUpdate={updateActiveView}
        onDelete={deleteView}
      />

      <FilterBar>
        <div className="flex gap-1">
          {TENDER_KINDS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={kind === option ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setKind(option);
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
            >
              {TENDER_KIND_LABELS[option]}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Search by title or tender number..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {TENDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TENDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priority}
          onValueChange={(value) => {
            setPriority(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            {TENDER_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActiveFilterChips
          columns={FILTERABLE_COLUMNS}
          conditions={conditions}
          onChange={(next) => {
            setConditions(next);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={PICKER_COLUMNS}
            visibleKeys={visibleKeys}
            order={columnOrder}
            defaultVisibleKeys={TENDER_DEFAULT_VISIBLE_KEYS}
            defaultOrder={TENDER_DEFAULT_ORDER}
            onChange={({ visibleKeys: nextVisible, order: nextOrder }) => {
              setVisibleKeys(nextVisible);
              setColumnOrder(nextOrder);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handleExport("csv", "view")}>
                Current view (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("xlsx", "view")}>
                Current view (XLSX)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("csv", "all")}>
                All matching (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("xlsx", "all")}>
                All matching (XLSX)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={tendersQuery.data?.items ?? []}
        isLoading={tendersQuery.isLoading}
        pageCount={tendersQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No tenders match your filters"
              description="Try adjusting your search, status, or filters."
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No tenders yet"
              description="Create your first tender to start tracking it from draft through award."
              action={canCreate ? newTenderButton : undefined}
            />
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: no errors. (Stop `next dev` first if running — see the repo's `.next` race gotcha.)

- [ ] **Step 3: Lint**

Run: `pnpm --filter @bmp/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/tenders/page.tsx"
git commit -m "feat(tenders): wire saved views, filter chips, column picker, sort, and export into the Tenders page"
```

---

### Task 18: Live-browser verification

No new code — this task is the closing gate per this session's standing instruction that
UI-visible changes must be verified in a real browser, not just typechecked. Run
`pnpm dev` (or ensure it's already running), then in a browser at `/tenders`, work through every
item below. Fix anything that doesn't behave as described before considering this plan done —
if a fix is needed, make it in the relevant task's files, re-run that task's tests, and re-verify
here.

- [ ] **Step 1: Filter chips**
  - Click `+`, pick a text column (e.g. Title), confirm the operator list shows is / is not /
    contains / has any value, pick "contains", type a value, click Apply Filter — a chip appears
    and the table narrows to matching rows.
  - Click `+` again, pick an enum column (Status), confirm operators are is / is not / is any of
    (no "has any value" — Status isn't nullable), pick "is any of", select two statuses — the chip
    reads correctly and the table filters to rows in either status.
  - Click an existing chip — the popover reopens pre-filled with that condition; change the value
    and re-apply — the chip and results update in place, not as a duplicate chip.
  - Click the chip's `X` — it's removed and the popover does not open.
  - With ≥1 chip active, confirm "Clear all" appears; click it — all chips clear and results reset.

- [ ] **Step 2: Column sort**
  - Click a sortable column header (e.g. Title) — an ascending arrow appears and rows reorder;
    click again — descending; click again — back to unsorted (or ascending, matching TanStack's
    default 3-state cycle).
  - Confirm the "Assignees" header is sortable (no chip filter for it, since it's excluded from
    `TENDER_FILTER_COLUMNS`, but it should still sort).

- [ ] **Step 3: Column picker**
  - Open "Columns", uncheck a column (e.g. Priority) — it disappears from the table immediately.
  - Re-check it — it reappears in its prior position.
  - Drag a column's grip handle to reorder it — the table's column order updates to match.
  - Click "Reset to default" — visibility and order both revert to the registry defaults.

- [ ] **Step 4: Saved views**
  - With some chips/columns/sort changed from default, click "Save as view", type a name, save —
    a new tab appears and becomes active.
  - Change something further — "Update with current filters" becomes available in the tab's
    overflow menu; use it — the change persists after switching to "Default" and back to this tab.
  - Rename the view via the overflow menu — the tab label updates.
  - Delete the view — the tab disappears and the page falls back to "Default".
  - Reload the page — saved views still list (they're server-persisted), but the active tab resets
    to "Default" (per this plan's deliberate no-auto-restore choice).

- [ ] **Step 5: Export**
  - With a filter chip active narrowing results to a handful of tenders, use Export → "Current
    view (CSV)" — a `.csv` file downloads, opens as text, and contains only the currently visible
    columns' data for the current page's rows.
  - Export → "All matching (XLSX)" — an `.xlsx` file downloads and opens in a spreadsheet app
    with a header row and every filtered row (not just the current page).
  - Hide a column via the Column Picker, then export "Current view (CSV)" again — confirm the
    hidden column is absent from the exported file (the `columns` param reflects visibility).

- [ ] **Step 6: Existing behavior is unbroken**
  - The kind tabs (Tender/Budgetary), the free-text search box, and the Status/Priority selects
    (all pre-existing, untouched by this plan) still filter correctly and combine with the new
    chip filters (AND semantics — e.g. a status Select value plus a priority chip both apply
    together).
  - Pagination (Previous/Next, "Page X of Y") still works with filters/sort active.
  - Creating a new tender, and downloading a tender's generated document via the row action menu,
    still work exactly as before.

- [ ] **Step 7: Run the full test suites once more**

```bash
pnpm exec dotenv -e .env.test -- pnpm exec turbo run test --filter=@bmp/server
pnpm --filter @bmp/web typecheck
pnpm --filter @bmp/ui typecheck
pnpm --filter @bmp/types typecheck
```
Expected: everything passes.

- [ ] **Step 8: Report what's explicitly out of scope**

Confirm (no code changes) that the following remain untouched, matching the spec's "Explicitly
deferred" section: RFQs, Items, Vendors, Organizations, Purchase Orders, Projects, Bills, Users
pages; the Finance/Invoices/Expenses card-grid; shared/team saved views; URL-synced filter state;
auto-restoring the last-used view; the page-size selector setting.
