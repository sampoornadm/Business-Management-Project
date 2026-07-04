# BMP — Phase 7 (Reporting & Intelligence) Implementation Plan

## Context

Phases 1–6 are complete and verified. Phase 7 covers the master spec's Reporting & Intelligence
module. Per `spec.md`: "Custom report builder, advanced dashboards, PDF/Excel exports, full-text
search, analytics, KPI tracking."

## Scope decisions

- **"Custom report builder" is a curated set of parameterized reports, not a generic query
  builder.** A drag-drop/arbitrary-query report designer is a multi-week feature in its own right and
  not what an 8-phase incremental ERP build should spend its Reporting phase on. Instead: five
  concrete report types (Tender Pipeline, Procurement Spend, Project Costing, Financial Summary,
  Vendor Performance), each accepting filter parameters (date range, status), each backed by one
  aggregation endpoint — same "computed read" discipline as every dashboard/summary endpoint in
  Phases 3–6. A true ad-hoc query builder can be scoped later if the curated set proves insufficient.
- **Full-text search is simple `contains` search across a few key tables, not Postgres
  `tsvector`.** A global `GET /search?q=` fans out `contains`/insensitive-mode queries across
  Tenders/Organizations/Vendors/Projects (the entities a user actually searches for by name/number)
  and merges results. Real `tsvector` full-text search is a schema migration + ranking exercise that
  isn't justified until this simple version is proven inadequate — same "best-effort, the simple
  version is the safety net" reasoning already applied to BOQ PDF parsing in Phase 3.
- **Excel export reuses `exceljs`** (already a Phase 3 dependency) to stream any report's rows into a
  `.xlsx` workbook. **PDF export adds `pdfkit`** (a lightweight, no-headless-browser PDF generator) for
  simple tabular report output — deliberately not `puppeteer`/a headless-browser HTML-to-PDF pipeline,
  which would be a much heavier dependency for what's fundamentally "print this table."
- **KPIs are a single dashboard-style endpoint**, not a configurable KPI framework: win rate,
  average BOQ turnaround (BOQ-preparation-to-submission time), average goods-receipt lead time,
  and days-sales-outstanding (DSO) for receivables — the handful of numbers the spec's "KPI tracking"
  line is asking for, computed from data that already exists across Phases 2–6.
- **One `reports` permission, read-only, broadly granted.** Every report reads data multiple roles
  can already see individually (tenders, BOQ, procurement, projects, finance summaries) — the
  aggregation itself introduces no new privilege boundary, so `reports:read` is simply added to the
  existing operational-role baseline alongside `boq:read`/`finance:read`/etc., rather than inventing
  a new tier of access control for a phase that's pure reads.

## Backend module (`apps/server/src/modules/reports/`)

Single module. Each report method aggregates existing Prisma models directly (no new tables) and
returns a `{ columns, rows }`-shaped result the frontend can render as a table/chart and the export
endpoint can serialize as-is.

| Report | Key numbers |
|---|---|
| Tender Pipeline | count by status, win rate (WON / (WON+LOST)), avg days DRAFT→SUBMITTED |
| Procurement Spend | Σ PO amount grouped by vendor and by month, within a date range |
| Project Costing | budget vs. Σ(PO spend + labor) vs. variance, per active project |
| Financial Summary | receivables/payables/cash-balance trend by month (reuses Phase 6 aggregation
  primitives, bucketed by month instead of a single point-in-time total) |
| Vendor Performance | average rating + on-time delivery rate (goods receipt date vs. PO expected
  delivery date) per vendor |
| KPIs | win rate, avg BOQ turnaround, avg goods-receipt lead time, receivables DSO |

Endpoints:

| Method & Path | Permission |
|---|---|
| GET /reports/tender-pipeline | `reports:read` |
| GET /reports/procurement-spend | `reports:read` |
| GET /reports/project-costing | `reports:read` |
| GET /reports/financial-summary | `reports:read` |
| GET /reports/vendor-performance | `reports:read` |
| GET /reports/kpis | `reports:read` |
| GET /reports/:reportKey/export?format=xlsx\|pdf | `reports:read` |
| GET /search?q= | `reports:read` |

RBAC addition: `reports:read`, added to the shared operational-role baseline (every seeded role
except none — even Viewer gets it, matching Viewer's existing "read-only access across the
platform").

## Frontend

- `apps/web/src/app/(dashboard)/reports/page.tsx` — a report picker (tabs, one per report type) each
  rendering a small filter bar (date range/status where applicable), a `dataviz`-skill-built chart or
  table, and "Export to Excel" / "Export to PDF" buttons that trigger a file download.
- `apps/web/src/app/(dashboard)/search/page.tsx` — a global search results page; the topbar gains a
  search input (next to the existing notification bell) that navigates there on submit.
- Nav addition: Reports (`reports:read`).

## Testing

Unit tests (fake repos where the aggregation is non-trivial): tender pipeline win-rate math with
zero-decided-tenders edge case (no division by zero); procurement spend grouping; vendor on-time
delivery rate calculation; KPI DSO formula. Integration test: seed a small set of tenders/POs/
payments via the API, hit each report endpoint, confirm the numbers match hand-computed expectations,
and confirm the Excel export endpoint returns a valid `.xlsx` (non-empty, correct content-type).

## Build order

1. RBAC matrix update (`reports:read`)
2. `reports/` module: the five report aggregations → KPIs → Excel/PDF export → global search
3. Backend tests
4. Frontend: reports page (charts/tables + export buttons), global search page + topbar search input
5. Install `pdfkit`, typecheck, lint, build, test across the full monorepo
6. Browser walkthrough: view each report with the data accumulated from Phases 2–6's walkthroughs,
   export one report to Excel and confirm the file downloads, run a global search for a known tender
   number and confirm it's found

## Critical files (once built)

- `apps/server/src/modules/reports/reports.service.ts` (all aggregation logic)
- `apps/server/src/modules/reports/reports.export.ts` (xlsx/pdf serialization)
- `packages/types/src/report.ts`, `packages/types/src/rbac.ts`

Phase 8 (Production Readiness) remains out of scope and will get its own plan once Phase 7 is
verified working end-to-end.

## Status: shipped and verified

Backend: 5 report endpoints + KPIs + xlsx/pdf export + global search, all in
`apps/server/src/modules/reports/`. 9 unit tests (`reports.service.spec.ts`, fake-repository style)
+ 5 integration tests (`reports.integration.spec.ts`, real Postgres via supertest) passing. Full
backend suite: 134/134 tests passing across 20 files, `typecheck`/`lint` clean.

Frontend: `apps/web/src/app/(dashboard)/reports/page.tsx` (KPI cards + tabbed report viewer — bar
charts for tender pipeline/procurement spend/financial summary via Recharts following the dashboard's
existing chart conventions, tables for project costing/vendor performance, date-range filters on the
two reports that accept them, Excel/PDF export buttons per report), `apps/web/src/app/(dashboard)/
search/page.tsx` (full results page, `?q=` synced to the URL), `apps/web/src/components/layout/
topbar-search.tsx` (debounced quick-search dropdown mounted in the topbar, top 8 results + "View all
results" link), `apps/web/src/hooks/use-reports.ts` (one hook per report + KPIs + search +
`downloadReportExport` blob-download helper). Nav item added (`Reports`, permission `reports:read`).
`pnpm --filter @bmp/web build/typecheck/lint` all clean.

Browser walkthrough (Playwright, logged in as `superadmin@bmp.local`) confirmed: all 5 report tabs
render real cross-phase data (tender pipeline win rate/status chart, procurement spend by
month/vendor, project costing table, financial summary received-vs-paid chart, vendor performance
table); Excel export downloads a real `.xlsx` file; topbar search dropdown and the dedicated search
page both correctly find tenders/projects by a real substring match. No console errors beyond a
benign transient 401 from the axios auto-refresh cycle (expected, already handled by the interceptor).
