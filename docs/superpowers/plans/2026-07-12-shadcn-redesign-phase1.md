# shadcn Redesign Phase 1: Primitives Audit + Tenders Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the shared-primitive gaps found in `packages/ui` (no `PageHeader`, `EmptyState`,
`StatCard`, `FilterBar`; `DataTable`'s empty state is a bare string) and prove them by retrofitting
the Tenders domain (list, detail, new, edit) plus the Dashboard's KPI tiles — no business logic,
API, or theme-token changes.

**Architecture:** Four new domain-agnostic component files (`PageHeader`, `EmptyState`,
`StatCard`/`KpiGrid`, `FilterBar`) go into `packages/ui/src/components/` and are re-exported from
`packages/ui/src/index.ts`, following the exact pattern every existing component there already uses
(`React.forwardRef`, `cn()` from `../lib/utils`, Tailwind classes driven by the existing HSL theme
tokens — no new colors). `DataTable` gets one new optional prop. Consuming pages in `apps/web`
import these from `@bmp/ui` exactly like `Button`/`Card`/`Select` today.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind CSS (existing "Steel & Blueprint"
theme + `tailwindcss-animate`), `lucide-react` icons, TanStack Table (via `DataTable`), Playwright
for E2E (this repo's established pattern — components/pages are verified through
`apps/web/e2e/*.spec.ts`, not React Testing Library; see Global Constraints).

## Global Constraints

- Preserve all functionality, API contracts, business logic, and RBAC — this is visual/structural
  polish only (from the design spec's Non-goals).
- No new theme colors or typography scale — reuse the existing HSL custom-property tokens in
  `apps/web/src/app/globals.css` ("Steel & Blueprint"): `bg-muted`, `text-muted-foreground`,
  `border-border`, `bg-primary`, etc.
- New `packages/ui` components must stay domain-agnostic — no "tender"/"vendor"/etc. strings in
  `packages/ui/src/components/*` (per this repo's CLAUDE.md convention).
- Animation: use Tailwind/`tailwindcss-animate` utilities (`animate-in`, `fade-in`, `animate-pulse`)
  only. Do not add new `framer-motion` usage — it is being removed as an unused dependency in Task
  6.
- Testing convention for this repo (from `apps/web/vitest.config.ts`'s own comment): **pages,
  hooks, and components are verified via the Playwright E2E suite (`apps/web/e2e/`), not component
  unit tests.** Do not add `@testing-library/react` component tests — that would fight an explicit,
  deliberate repo convention. Each task's verification step is either (a) a Playwright E2E
  assertion where the task changes user-observable page behavior, or (b) `typecheck`/`lint` plus an
  explicit manual browser check where the change is visual/layout-only (this matches this repo's
  CLAUDE.md instruction to verify UI changes in a live browser).
- Commands run from the repo root use pnpm workspace filters: `pnpm --filter @bmp/ui <script>` and
  `pnpm --filter @bmp/web <script>`.

---

### Task 1: `PageHeader` component

**Files:**
- Create: `packages/ui/src/components/page-header.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `PageHeader` component — `React.forwardRef<HTMLDivElement, PageHeaderProps>` where
  `PageHeaderProps extends React.HTMLAttributes<HTMLDivElement>` with `title: string`,
  `description?: string`, `actions?: React.ReactNode`.

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/page-header.tsx
"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, actions, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", className)}
      {...props}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
```

- [ ] **Step 2: Export it from the package**

Add this line to `packages/ui/src/index.ts`, alphabetically near the other component exports
(after `export * from "./components/pagination";` is a reasonable spot, but exact position doesn't
matter — this file has no enforced order):

```ts
export * from "./components/page-header";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/page-header.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add PageHeader component"
```

---

### Task 2: `EmptyState` component

**Files:**
- Create: `packages/ui/src/components/empty-state.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `EmptyState` component — `React.forwardRef<HTMLDivElement, EmptyStateProps>` where
  `EmptyStateProps extends React.HTMLAttributes<HTMLDivElement>` with
  `icon?: React.ComponentType<{ className?: string }>`, `title: string`, `description?: string`,
  `action?: React.ReactNode`.

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/empty-state.tsx
"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon: Icon, title, description, action, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center animate-in fade-in duration-300",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  ),
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
```

- [ ] **Step 2: Export it from the package**

Add to `packages/ui/src/index.ts`:

```ts
export * from "./components/empty-state";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/empty-state.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add EmptyState component"
```

---

### Task 3: `StatCard` and `KpiGrid` components

**Files:**
- Create: `packages/ui/src/components/stat-card.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Card`, `CardHeader`, `CardTitle`, `CardContent` from `./card` (Task-independent,
  already exist); `Skeleton` from `./skeleton` (already exists).
- Produces: `StatCard` — `React.forwardRef<HTMLDivElement, StatCardProps>` where
  `StatCardProps extends React.HTMLAttributes<HTMLDivElement>` with `label: string`,
  `value: React.ReactNode`, `icon?: React.ComponentType<{ className?: string }>`,
  `isLoading?: boolean`. `KpiGrid` — `React.forwardRef<HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>>`, a grid layout wrapper.

- [ ] **Step 1: Create the components**

```tsx
// packages/ui/src/components/stat-card.tsx
"use client";

import * as React from "react";

import { cn } from "../lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Skeleton } from "./skeleton";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  isLoading?: boolean;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, icon: Icon, isLoading = false, className, ...props }, ref) => (
    <Card ref={ref} className={className} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="font-mono text-2xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  ),
);
StatCard.displayName = "StatCard";

const KpiGrid = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)} {...props} />
  ),
);
KpiGrid.displayName = "KpiGrid";

export { StatCard, KpiGrid };
```

- [ ] **Step 2: Export it from the package**

Add to `packages/ui/src/index.ts`:

```ts
export * from "./components/stat-card";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/stat-card.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add StatCard and KpiGrid components"
```

---

### Task 4: `FilterBar` component

**Files:**
- Create: `packages/ui/src/components/filter-bar.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `FilterBar` — `React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>`,
  a flex-wrap layout wrapper (same shape as the inline filter row currently duplicated across list
  pages).

- [ ] **Step 1: Create the component**

```tsx
// packages/ui/src/components/filter-bar.tsx
"use client";

import * as React from "react";

import { cn } from "../lib/utils";

const FilterBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-wrap items-center gap-3", className)} {...props} />
  ),
);
FilterBar.displayName = "FilterBar";

export { FilterBar };
```

- [ ] **Step 2: Export it from the package**

Add to `packages/ui/src/index.ts`:

```ts
export * from "./components/filter-bar";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/filter-bar.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add FilterBar layout component"
```

---

### Task 5: `DataTable` gets an `emptyState` prop and a fade-in transition

**Files:**
- Modify: `packages/ui/src/components/data-table.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DataTableProps.emptyState?: React.ReactNode` — when the table has zero rows and is
  not loading, renders this instead of the current hard-coded `"No results."` text. When omitted,
  behavior is unchanged (existing consumers keep working with no code changes).

- [ ] **Step 1: Add the prop and read the current file's exact empty-state block**

Read `packages/ui/src/components/data-table.tsx`. The block to change is the final branch of the
`isLoading ? ... : table.getRowModel().rows.length ? ... : (...)` ternary (currently lines 99-105):

```tsx
            ) : (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
```

- [ ] **Step 2: Add the `emptyState` prop to the interface and destructuring**

Change:

```tsx
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  pageCount: number;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
}
```

to:

```tsx
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  isLoading?: boolean;
  pageCount: number;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Rendered instead of the default "No results." text when there are zero rows. */
  emptyState?: React.ReactNode;
}
```

And change the function signature from:

```tsx
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  pageCount,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
}: DataTableProps<TData, TValue>) {
```

to:

```tsx
export function DataTable<TData, TValue>({
  columns,
  data,
  isLoading = false,
  pageCount,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  emptyState,
}: DataTableProps<TData, TValue>) {
```

- [ ] **Step 3: Replace the empty-state row and add a fade-in to populated rows**

Change:

```tsx
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
```

to:

```tsx
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="animate-in fade-in duration-200"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="p-0">
                  {emptyState ?? (
                    <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                      No results.
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/ui typecheck`
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/data-table.tsx
git commit -m "feat(ui): add DataTable emptyState prop and row fade-in"
```

---

### Task 6: Remove the unused `framer-motion` dependency

**Files:**
- Modify: `apps/web/package.json`

**Interfaces:** none (dependency removal only).

- [ ] **Step 1: Confirm it's really unused**

Run: `grep -rl "framer-motion" apps/web/src`
Expected: no output (no matches) — confirms zero imports before removing the dependency.

- [ ] **Step 2: Remove the dependency line**

In `apps/web/package.json`, delete this line from `dependencies`:

```json
    "framer-motion": "^11.15.0",
```

- [ ] **Step 3: Reinstall to update the lockfile**

Run: `pnpm install`
Expected: exits 0; `pnpm-lock.yaml` updates to drop `framer-motion` and its sub-dependencies.

- [ ] **Step 4: Typecheck and build still pass**

Run: `pnpm --filter @bmp/web typecheck`
Expected: exits 0, no errors (confirms nothing referenced the removed package).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): remove unused framer-motion dependency"
```

---

### Task 7: Retrofit the Tenders list page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/page.tsx`
- Modify: `apps/web/e2e/tenders.spec.ts`

**Interfaces:**
- Consumes: `PageHeader` (Task 1), `EmptyState` (Task 2), `FilterBar` (Task 4), `DataTable`'s
  `emptyState` prop (Task 5) — all from `@bmp/ui`.

- [ ] **Step 1: Write the failing E2E test**

Add this test inside the existing `test.describe("Tenders", ...)` block in
`apps/web/e2e/tenders.spec.ts` (add it as a new `test(...)` alongside the existing one, after the
existing test's closing `});`):

```ts
  test("shows a filtered-empty state when no tenders match the search", async ({ page }) => {
    await login(page);
    await page.goto("/tenders");
    await page.fill('input[placeholder="Search by title or tender number..."]', `no-such-tender-${Date.now()}`);
    await expect(page.getByText("No tenders match your filters")).toBeVisible();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bmp/web test:e2e -- -g "filtered-empty state"`
Expected: FAIL — the page currently renders `"No results."`, not `"No tenders match your filters"`.
(Requires the dev stack running: `docker compose up -d postgres redis minio minio-init mailhog`
plus `pnpm dev` and migrations/seed applied, per this repo's existing e2e setup.)

- [ ] **Step 3: Retrofit the page**

Replace the full contents of `apps/web/src/app/(dashboard)/tenders/page.tsx` with:

```tsx
"use client";

import { TENDER_PRIORITIES, TENDER_STATUS_LABELS, TENDER_STATUSES, type TenderPriority, type TenderStatus } from "@bmp/types";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bmp/ui";
import type { PaginationState } from "@tanstack/react-table";
import { FilePlus, FileText, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { tenderTableColumns } from "@/components/tenders/tender-table-columns";
import { useTenders } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export default function TendersPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const tendersQuery = useTenders({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: (status || undefined) as TenderStatus | undefined,
    priority: (priority || undefined) as TenderPriority | undefined,
  });

  const canCreate = hasPermission(roleName, "tenders:create");
  const hasActiveFilters = Boolean(debouncedSearch || status || priority);

  const newTenderButton = (
    <Button asChild>
      <Link href="/tenders/new">
        <FilePlus className="mr-2 h-4 w-4" /> New Tender
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenders"
        description="Track tenders from draft through award."
        actions={canCreate ? newTenderButton : undefined}
      />

      <FilterBar>
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

      <DataTable
        columns={tenderTableColumns}
        data={tendersQuery.data?.items ?? []}
        isLoading={tendersQuery.isLoading}
        pageCount={tendersQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No tenders match your filters"
              description="Try adjusting your search, status, or priority filters."
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

- [ ] **Step 4: Run the E2E test again to verify it passes**

Run: `pnpm --filter @bmp/web test:e2e -- -g "filtered-empty state"`
Expected: PASS.

- [ ] **Step 5: Run the full Tenders E2E spec to check for regressions**

Run: `pnpm --filter @bmp/web test:e2e -- apps/web/e2e/tenders.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Manual browser check**

Start `pnpm dev`, open `/tenders` at a 375px viewport width and confirm: the filter row wraps
cleanly with no horizontal overflow, the header's "New Tender" button sits below the title on
mobile and to the right on desktop, and both dark and light mode render the empty state's dashed
border and icon circle correctly (toggle via the existing theme toggle in the topbar).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/tenders/page.tsx apps/web/e2e/tenders.spec.ts
git commit -m "feat(web): retrofit Tenders list page with PageHeader, FilterBar, EmptyState"
```

---

### Task 8: Responsive grids + `PageHeader` on Tender New/Edit pages

**Files:**
- Modify: `apps/web/src/components/tenders/tender-form.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/new/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `PageHeader` (Task 1) from `@bmp/ui`.
- No new props produced — `TenderForm`'s existing `TenderFormProps` interface is unchanged; only
  Tailwind classes inside its JSX change.

- [ ] **Step 1: Make `tender-form.tsx`'s field grids responsive**

`tender-form.tsx` currently uses `grid-cols-2` and `grid-cols-3` unconditionally, which cram 2-3
columns even on a narrow phone screen. Make each responsive: 1 column by default, expanding at the
`sm` breakpoint. There are four such grids in the file — replace each exactly as shown:

Grid 1 (tender number / department, inside "Basic information"):
```tsx
            <div className="grid grid-cols-2 gap-4">
```
becomes
```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
```

Grid 2 (type / category / priority, inside "Client & classification"):
```tsx
            <div className="grid grid-cols-3 gap-4">
```
becomes
```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
```

Grid 3 (state / location, inside "Client & classification"):
```tsx
            <div className="grid grid-cols-2 gap-4">
```
becomes
```tsx
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
```

Grid 4 (dealing officer name / email / phone — this one is on the `CardContent` element itself):
```tsx
          <CardContent className="grid grid-cols-3 gap-4">
```
becomes
```tsx
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
```

Grid 5 (financials: estimated cost / EMD / tender fee / document fee):
```tsx
          <CardContent className="grid grid-cols-2 gap-4">
```
becomes
```tsx
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
```

Grid 6 (dates: submission / opening / validity):
```tsx
          <CardContent className="grid grid-cols-3 gap-4">
```
becomes
```tsx
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
```

(Grids 4-6 have identical `grid-cols-3`/`grid-cols-2` text to grids 1-3 in this file — when
editing, go top-to-bottom through the file in the order described above so each replacement targets
the correct occurrence.)

- [ ] **Step 2: Adopt `PageHeader` on the New Tender page**

In `apps/web/src/app/(dashboard)/tenders/new/page.tsx`, add `PageHeader` to the `@bmp/ui` import:

```tsx
import {
  Card,
  CardContent,
  CITIES_BY_STATE,
  INDIA_STATES,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useToast,
  type IndiaState,
} from "@bmp/ui";
```

Replace:

```tsx
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Tender</h1>
        <p className="text-sm text-muted-foreground">Create a new tender record.</p>
      </div>
```

with:

```tsx
    <div className="max-w-3xl space-y-6">
      <PageHeader title="New Tender" description="Create a new tender record." />
```

(This changes only the opening two lines of the returned JSX; the rest of the page — the
extraction-upload card, extracted-items table, and `<TenderForm>` — is unchanged.)

- [ ] **Step 3: Adopt `PageHeader` on the Edit Tender page**

In `apps/web/src/app/(dashboard)/tenders/[id]/edit/page.tsx`, add `PageHeader` to the `@bmp/ui`
import:

```tsx
import { PageHeader, Skeleton, useToast } from "@bmp/ui";
```

Replace:

```tsx
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Tender</h1>
      </div>
      <TenderForm
```

with:

```tsx
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Edit Tender" />
      <TenderForm
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: exits 0, no errors.

- [ ] **Step 5: Manual browser check**

Start `pnpm dev`. Open `/tenders/new` at 375px width and confirm every form grid (Basic
information, Client & classification, Dealing officer, Financials, Dates) stacks to a single
column with no cramped/overlapping fields, then confirm it returns to the multi-column layout at a
desktop width (e.g. 1280px). Repeat the same width check on `/tenders/[id]/edit` for an existing
tender. Confirm both pages' new `PageHeader` renders identically to the previous plain heading in
both light and dark mode.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tenders/tender-form.tsx apps/web/src/app/\(dashboard\)/tenders/new/page.tsx apps/web/src/app/\(dashboard\)/tenders/\[id\]/edit/page.tsx
git commit -m "feat(web): responsive form grids and PageHeader on Tender new/edit pages"
```

---

### Task 9: Responsive overview grid on the Tender detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:** none new — Tailwind class change only. (This page's header intentionally keeps its
custom markup rather than adopting `PageHeader`: it interleaves two `Badge`s next to the title,
which `PageHeader`'s `title: string` prop doesn't support, and forcing that shape into `PageHeader`
would mean widening that component's API for a single caller — not worth it per this repo's
YAGNI convention.)

- [ ] **Step 1: Make the overview grid responsive**

The Overview tab's details grid currently reads (around line 174):

```tsx
            <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm">
```

Change it to:

```tsx
            <CardContent className="grid grid-cols-1 gap-4 pt-6 text-sm sm:grid-cols-2">
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Manual browser check**

Open an existing tender's detail page at 375px width and confirm the "Department / Type / Category
/ Location / Estimated cost / ..." grid stacks to one column instead of squeezing two per row, then
confirm it returns to two columns at a desktop width.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/tenders/\[id\]/page.tsx
git commit -m "fix(web): make Tender detail overview grid responsive on mobile"
```

---

### Task 10: Add skeleton loading to async Tender tabs

**Files:**
- Modify: `apps/web/src/components/tenders/tender-documents-tab.tsx`
- Modify: `apps/web/src/components/tenders/tender-assignees-tab.tsx`

**Interfaces:** none new — uses the existing `Skeleton` component from `@bmp/ui`, following the
exact loading-guard pattern already used by `tender-items-tab.tsx` and `tender-history-tab.tsx` in
this same directory (`if (query.isLoading) { return <Skeleton .../>; }`).

Two of the five Tender detail tabs fetch their own data with no loading guard at all:
`TenderDocumentsTab` briefly renders every document type as "empty" (its `EmptyDocumentSlot`, an
upload dropzone) before `useTenderDocuments` resolves, even when files already exist.
`TenderAssigneesTab`'s "assign a user" control renders with an empty dropdown before `useUsers`
resolves. (`TenderCompetitorsTab` has no gap — it reads straight from the already-loaded `tender`
prop, no query of its own.)

- [ ] **Step 1: Add a loading guard to `TenderDocumentsTab`**

Change the `@bmp/ui` import from:

```tsx
import { DocumentUpload, type DocumentVersion, useToast } from "@bmp/ui";
```

to:

```tsx
import { DocumentUpload, Skeleton, type DocumentVersion, useToast } from "@bmp/ui";
```

Change:

```tsx
export function TenderDocumentsTab({ tenderId }: { tenderId: string }) {
  const documentsQuery = useTenderDocuments(tenderId);
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canDelete = hasPermission(roleName, "attachments:delete");

  const groupIdsByType = new Map<TenderDocumentType, string[]>();
```

to:

```tsx
export function TenderDocumentsTab({ tenderId }: { tenderId: string }) {
  const documentsQuery = useTenderDocuments(tenderId);
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canDelete = hasPermission(roleName, "attachments:delete");

  if (documentsQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const groupIdsByType = new Map<TenderDocumentType, string[]>();
```

- [ ] **Step 2: Add a loading guard to `TenderAssigneesTab`'s assign control only**

`tender.assignees` (the already-visible list below the control) comes from the parent tender fetch
and is never stale/loading here — only the "assign a user" row depends on `usersQuery`, so only
that row gets the guard; the assignee list stays visible immediately.

Change the `@bmp/ui` import from:

```tsx
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
```

to:

```tsx
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useToast,
} from "@bmp/ui";
```

Change:

```tsx
      {canAssign && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
```

to:

```tsx
      {canAssign && usersQuery.isLoading && <Skeleton className="h-16 w-full" />}
      {canAssign && !usersQuery.isLoading && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
```

(The existing closing `</div>` and `)}` for this block are unchanged — only the opening condition
gains the `!usersQuery.isLoading` check and a sibling skeleton line above it.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: exits 0, no errors.

- [ ] **Step 4: Manual browser check**

Open an existing tender's detail page. On the "Documents" tab, do a hard refresh and confirm a
skeleton briefly shows instead of a flash of empty upload dropzones (most visible on a throttled
network — Chrome DevTools Network tab, "Slow 4G"). On the "Assignees" tab, confirm the assignee
list (if any) is visible immediately while the "assign a user" control briefly shows a skeleton,
then resolves to the real dropdown.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tenders/tender-documents-tab.tsx apps/web/src/components/tenders/tender-assignees-tab.tsx
git commit -m "fix(web): add skeleton loading guards to Tender Documents and Assignees tabs"
```

---

### Task 11: Adopt `StatCard`/`KpiGrid` on the Dashboard page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `StatCard`, `KpiGrid` (Task 3) from `@bmp/ui`.

- [ ] **Step 1: Replace the four top KPI `Card`s with `StatCard`/`KpiGrid`**

In `apps/web/src/app/(dashboard)/dashboard/page.tsx`, change the `@bmp/ui` import from:

```tsx
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@bmp/ui";
```

to:

```tsx
import { Badge, Card, CardContent, CardHeader, CardTitle, KpiGrid, Skeleton, StatCard } from "@bmp/ui";
```

Replace this whole block:

```tsx
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {usersQuery.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="font-mono text-2xl font-bold">{usersQuery.data?.totalItems ?? 0}</div>
            )}
          </CardContent>
        </Card>

        {canReadTenders && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Tenders</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {tenderStatsQuery.isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="font-mono text-2xl font-bold">{tenderStatsQuery.data?.totalActive ?? 0}</div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Your Role</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{user?.role.name}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.postgres} /> Database
            </div>
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.redis} /> Cache
            </div>
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.s3} /> File storage
            </div>
          </CardContent>
        </Card>
      </div>
```

with:

```tsx
      <KpiGrid>
        <StatCard
          label="Total Users"
          icon={Users2}
          isLoading={usersQuery.isLoading}
          value={usersQuery.data?.totalItems ?? 0}
        />

        {canReadTenders && (
          <StatCard
            label="Active Tenders"
            icon={FileText}
            isLoading={tenderStatsQuery.isLoading}
            value={tenderStatsQuery.data?.totalActive ?? 0}
          />
        )}

        <StatCard label="Your Role" icon={Activity} value={<Badge variant="secondary">{user?.role.name}</Badge>} />

        <StatCard
          label="System Health"
          icon={HardDrive}
          value={
            <div className="space-y-1 text-sm font-normal">
              <div className="flex items-center gap-2">
                <HealthDot ok={healthQuery.data?.postgres} /> Database
              </div>
              <div className="flex items-center gap-2">
                <HealthDot ok={healthQuery.data?.redis} /> Cache
              </div>
              <div className="flex items-center gap-2">
                <HealthDot ok={healthQuery.data?.s3} /> File storage
              </div>
            </div>
          }
        />
      </KpiGrid>
```

Note the `font-mono text-2xl font-bold` styling `StatCard` applies to its `value` slot only makes
sense for the numeric cards — for "Your Role" and "System Health" this block overrides it with
`font-normal` on its own wrapping `div` so the badge/health-dot list doesn't inherit the oversized
monospace numeral styling. `CardHeader`/`CardTitle`/`CardContent` become unused-if-nothing-else-in-
the-file-uses-them — check the rest of `dashboard/page.tsx` before removing their import (the
"Tenders by Status", "Upcoming Deadlines", and "Recent Activity" cards further down the same file
still use `Card`/`CardHeader`/`CardContent`/`CardTitle` directly, so keep all four in the import).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/web typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Manual browser check**

Start `pnpm dev`, open `/dashboard` and confirm all four tiles render identically to before
(same numbers, same badge, same health dots), the loading skeleton still appears briefly on page
load for "Total Users" and "Active Tenders", and the layout still reflows from 1 to 2 to 3 columns
as viewport width increases. Check both light and dark mode.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/page.tsx
git commit -m "feat(web): adopt StatCard/KpiGrid on the dashboard's KPI tiles"
```

---

### Task 12: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck everything**

Run: `pnpm --filter @bmp/ui typecheck && pnpm --filter @bmp/web typecheck`
Expected: both exit 0.

- [ ] **Step 2: Lint everything**

Run: `pnpm --filter @bmp/ui lint && pnpm --filter @bmp/web lint`
Expected: both exit 0.

- [ ] **Step 3: Run the full web unit test suite**

Run: `pnpm --filter @bmp/web test`
Expected: all existing tests still pass (no business logic touched, so no test should need
updating other than the one added in Task 7).

- [ ] **Step 4: Run the full Playwright E2E suite**

Run: `pnpm --filter @bmp/web test:e2e`
Expected: all specs pass, including the new filtered-empty-state test from Task 7. (Requires the
dev stack up: `docker compose up -d postgres redis minio minio-init mailhog`, `pnpm dev`, DB
migrated and seeded.)

- [ ] **Step 5: Final manual pass**

With `pnpm dev` running, walk through `/tenders`, `/tenders/new`, an existing tender's detail page,
that tender's edit page, and `/dashboard` once each in light mode and once in dark mode (toggle via
the topbar), each at both a 375px mobile width and a normal desktop width. Confirm: no layout
regressions, no console errors, all toasts still fire on tender create/update/status-change/delete,
and the new empty states/PageHeaders/StatCards look visually consistent with the rest of the app's
existing "Steel & Blueprint" theme.

- [ ] **Step 6: No commit needed for this task** — it's verification-only. If any check in Steps
1-5 fails, fix the issue in the file it points to and re-run that step before moving on; do not
commit a fix without re-running the full sequence from Step 1.

---

## Rollout After This Plan

Once this plan is merged and the Tenders pilot is reviewed, the same primitives (`PageHeader`,
`EmptyState`, `StatCard`, `KpiGrid`, `FilterBar`, `DataTable.emptyState`) get applied to the
remaining six domains (BOQ/estimation, procurement, project execution, finance, reporting,
settings/admin) as separate, smaller plans — each one now just "apply existing primitives to
domain X," per the design spec's Rollout section.
