# shadcn/ui Redesign — Phase 1: Shared Primitives Audit + Tenders Pilot

## Context

The user asked for a full redesign of the Business Management Platform (BMP) frontend using
shadcn/ui with a premium-SaaS polish bar (typography, spacing, hierarchy, mobile-first,
accessibility, dark mode, animation, empty states, skeleton loading, toasts) while preserving all
functionality, APIs, and business logic.

Investigation before design showed this is **not a blank-slate rebuild**: `packages/ui` already
has 28 shadcn-based components (Button, Card, Dialog, Select, Table, DataTable, Form, Tabs,
Stepper, MultiSelect, Skeleton, Toast, EditableTreeTable, etc.), a custom "Steel & Blueprint" HSL
theme with a working dark mode (`next-themes`, `apps/web/src/providers/theme-provider.tsx`), and a
sidebar/topbar dashboard shell. The work is a **polish and consistency pass**, not a rebuild of
primitives or theme.

The app spans 37+ pages across 7 domains (tenders, BOQ/estimation, procurement, project execution,
finance, reporting, settings/admin) — too large for one spec. This spec covers only the first
slice: a shared-primitives audit (closing real gaps found below) plus a full pilot retrofit of one
domain (Tenders) to validate the new primitives against real usage before rolling out to the
remaining six domains in later specs.

## Goals

- Close concrete gaps in `packages/ui` that block the stated polish goals (elegant empty states,
  professional dashboards, reduced duplication).
- Prove the new primitives on a real domain end-to-end (list, detail, create, edit) before
  generalizing.
- Preserve all existing functionality, API contracts, business logic, and the existing theme
  tokens — this is visual/structural polish only.

## Non-goals

- The other six domains (BOQ/estimation, procurement, project execution, finance, reporting,
  settings/admin) — separate specs, same pattern, after this pilot is validated.
- New theme colors, typography scale, or design tokens — the existing "Steel & Blueprint" palette
  and dark-mode tokens in `apps/web/src/app/globals.css` stay as-is.
- Business logic, RBAC, API routes/DTOs, or database schema changes.
- Introducing `framer-motion` usage (see Animation Approach below — it's actually being dropped,
  not adopted).

## Audit Findings

Concrete duplication/gaps found by reading the current code (not hypothetical):

1. **No shared page header.** Every list page (e.g. `apps/web/src/app/(dashboard)/tenders/page.tsx`
   lines 48-61) hand-rolls the same `<h1>` + description + right-aligned action button block.
   Same shape repeats across vendors, projects, purchase-orders, rfqs, organizations, users pages.
2. **`DataTable`'s empty state is a bare string.** `packages/ui/src/components/data-table.tsx`
   lines 100-104 render `"No results."` as plain centered text — not an "elegant empty state" by
   any reading of that goal, and gives no path to a call-to-action (e.g. "Create your first
   tender").
3. **No shared `StatCard`/KPI tile component.** The dashboard page has an ad hoc `KpiCards()`
   implementation; there's no reusable primitive other pages (or future dashboards) can reuse.
4. **Filter bar duplication.** The search-input + status-select + priority-select row
   (`tenders/page.tsx` lines 63-109) is the same layout shape reimplemented per list page.
5. **`framer-motion` is an installed, unused dependency** (`apps/web/package.json`, zero imports
   found in `apps/web/src`). `tailwindcss-animate` is already pulled in via the shared Tailwind
   preset and already drives shadcn Dialog/Dropdown/Select enter-exit transitions. Standardizing on
   Tailwind/CSS transitions + `tailwindcss-animate` for all new animation work (rather than
   reaching for framer-motion) keeps bundle size down (the "Fast" goal) and keeps one animation
   idiom instead of two. `framer-motion` can be removed from `apps/web/package.json` as part of
   this work since nothing depends on it.
6. **Forms are already in good shape.** `packages/ui/src/components/form.tsx` wraps RHF + zod +
   shadcn conventions correctly, and `tender-form.tsx` (583 lines, stepper-based) already follows
   it. This pilot only needs a spacing/hierarchy pass here, not a rearchitect.

## New / Changed Components (`packages/ui/src/components/`)

All new components are domain-agnostic (no "tender"/"vendor" strings), consistent with this
repo's existing rule that `packages/ui` stays reusable across every module.

1. **`PageHeader`** — `title`, optional `description`, optional `actions` slot (right-aligned
   button/button-group). Replaces the repeated header block in every list/detail page.
2. **`EmptyState`** — icon + title + description + optional action button, centered layout.
   Used two ways:
   - Standalone, for whole-page empty conditions.
   - As a new `emptyState` prop on `DataTable`, rendered in place of the current bare
     `"No results."` cell when there are zero rows.
3. **`StatCard`** and a `KpiGrid` layout wrapper — for dashboard-style metric tiles. Generalizes
   the dashboard page's current ad hoc `KpiCards()` into something reusable by any future
   dashboard-shaped page.
4. **`FilterBar`** — a thin flex-wrap/gap layout wrapper for the search+select row pattern. This is
   intentionally just a layout container, not a new abstraction over `Input`/`Select` — avoids
   over-engineering while still killing the duplicated container markup.
5. **`DataTable` changes** — add the `emptyState` prop (falls back to current text if omitted, so
   other domains aren't broken until they're migrated); add a subtle `animate-in fade-in`
   transition on data swap using `tailwindcss-animate` utilities.

## Tenders Pilot (list / detail / new / edit)

- **List** (`tenders/page.tsx`): adopt `PageHeader`, `FilterBar`, and `DataTable`'s new
  `emptyState` (e.g. "No tenders yet" + a "New Tender" call-to-action button, shown only when
  there are zero rows *and* no active filters — a filtered empty result gets a plainer "No tenders
  match your filters" message instead).
- **Detail** (`tenders/[id]/page.tsx`): spacing/hierarchy pass across tabs, skeleton loading for
  any async tab content, verify toast coverage on every mutation (status change, assignee change,
  document upload, etc. — `useToast` already exists, this is a coverage check not new plumbing).
- **New / Edit** (`tenders/new/page.tsx`, `tender-form.tsx`): visual/spacing pass on the existing
  stepper form. No field, validation, or submission-logic changes.
- **Mobile-first**: verify sidebar collapse, table horizontal scroll, and filter-bar wrapping at a
  375px viewport.
- **Dark mode**: every new/changed component verified in both themes against the existing
  "Steel & Blueprint" tokens — no new colors introduced.

## Testing / Verification

- `pnpm typecheck` and `pnpm lint` across `packages/ui` and `apps/web`.
- Manual browser verification (this repo's CLAUDE.md requires testing UI changes in a live
  browser, not just typecheck/lint) covering: light + dark mode, desktop + mobile (375px)
  viewport, on all four Tenders pilot pages (list, detail, new, edit) — golden path plus the empty
  states (no tenders, filtered-to-zero).
- No changes to Vitest unit/integration suites are expected (no business logic changes); existing
  suites must still pass.

## Rollout After This Spec

Once the Tenders pilot is reviewed and approved, the same `PageHeader` / `EmptyState` / `StatCard`
/ `FilterBar` / `DataTable.emptyState` primitives get applied to the remaining six domains
(BOQ/estimation, procurement, project execution, finance, reporting, settings/admin) as separate,
smaller specs — each one is now just "apply existing primitives to domain X" rather than a design
decision.
