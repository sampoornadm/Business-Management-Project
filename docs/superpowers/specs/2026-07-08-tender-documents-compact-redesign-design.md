# Tender Documents Tab — Compact Redesign + E2E Test Coverage

## Problem

The Documents tab on a tender's detail page (`TenderDocumentsTab`) renders one full
shadcn `Card` per document type (8 types: NIT, BOQ, Technical Specs, Drawings,
Corrigendum, Tender Notice, Addendum, General), each with its own `CardHeader` and an
8-line-tall dashed drop-zone when empty. For a typical tender with only 1-2 document
types filled in, this is ~1,150px of near-empty cards before you reach anything else on
the page — visually heavy and inconsistent (filled cards and empty cards look
structurally different from each other).

Confirmed via a side-by-side HTML mockup (before/after, same sample data) during
brainstorming — approved by the user.

## Goals

- Shrink the Documents tab to a compact, uniform list — same information, far less
  vertical space (~420px for the same 8-type/2-filled example, vs. ~1,150px today).
- Every document type reads the same way whether empty or filled — no more
  structurally-different empty vs. filled cards.
- Preserve all existing behavior exactly: per-type replace-in-place, delete-with-confirm,
  multi-file lineages per type (e.g. multiple Drawings files), expandable version
  history. This is a presentation-only change — no API, hook, or data-flow changes.
- Add an end-to-end test covering the redesigned Documents tab, following this repo's
  existing, deliberate testing split: Vitest is scoped to plain-function logic in
  `src/lib/**` only (see `apps/web/vitest.config.ts`'s coverage config and its inline
  comment), while pages/components are verified via the Playwright suite in
  `apps/web/e2e/`. This change adds to that existing suite rather than introducing a
  second, inconsistent frontend-testing style.

## Non-goals

- No change to the "extract from document" AI upload flow on the New Tender page (a
  separate, single-purpose dropzone — not part of this complaint).
- No change to `AttachmentsService`, the upload API, S3 storage, or the
  `Attachment`/`documentGroupId`/`isCurrent` versioning model.
- No Vitest component-test setup for `apps/web`/`packages/ui` — explicitly decided
  against for this task, since it would fight the repo's existing documented convention
  of using Playwright for page/component coverage (see Testing section).
- No broader design-system changes (no new UI libraries — sticking to the existing
  shadcn/ui + Tailwind + Lucide stack already used everywhere else in `packages/ui`).

## Design

### Component changes (presentation-only)

**`packages/ui/src/components/document-upload.tsx`** — `DocumentUpload` stops
rendering as a `Card` (`CardHeader` + padded `CardContent` with an 8-line dashed
dropzone) and instead renders as a single compact row (~44-52px):

- Filled state: filename (link) + size/version meta on one line, `Replace` pill-button
  and a delete icon-button on the right.
- Empty state: "No file uploaded" text + a small `Upload` pill-button on the right —
  same row height and alignment as the filled state, so empty and filled rows look like
  the same component, just different content.
- Version history (shown today when `versions.length > 1`) keeps its current
  expand/collapse behavior, just re-styled to fit the tighter row.
- Props/API (`label`, `versions`, `onUpload`, `onDelete`, `isUploading`, `isDeleting`,
  `accept`, `className`) are unchanged — this is an internal render change only, so no
  caller besides `tender-documents-tab.tsx` needs to change how it invokes the component.

**`apps/web/src/components/tenders/tender-documents-tab.tsx`** — `DocumentTypeSection`
drops the `grid md:grid-cols-2` card grid. All 8 type sections are wrapped in one shared
`rounded-md border divide-y` container instead of each type owning its own floating
card block, so the tab reads as one continuous list. Within a type that already has
files, a small trailing "+ Add another file" link (instead of a second full-size empty
card) is the affordance for adding another lineage — matches the approved mockup.

### Testing (Playwright E2E, matching existing convention)

No new tooling or infrastructure needed — `apps/web/e2e/` and `pnpm test:e2e` (Playwright)
already exist and already cover this exact category of thing (create-a-tender-and-drive-
the-UI flows, e.g. `tenders.spec.ts`). This adds one new spec:
`apps/web/e2e/tender-documents.spec.ts`, following `tenders.spec.ts`'s pattern
(`apiLogin`/`login` helpers, creating fixtures via direct API calls in `beforeAll`, then
driving the real UI):

- Create a tender (via API, like `tenders.spec.ts` does for its organization fixture),
  navigate to its Documents tab.
- Upload a file against an empty document-type row; assert the row switches from the
  empty "No file uploaded" state to showing the filename and a `Replace` control — this
  is the core "does the compact row layout actually work" check.
- Replace it with a second file; assert the filename updates and version history now
  shows 2 versions.
- Delete it; assert the row returns to the empty state.
- A type with two uploaded file lineages (e.g. two Drawings files) renders two rows plus
  the "+ Add another file" affordance, and an untouched type still renders its empty-row
  affordance — covers the `groupIdsByType` grouping logic in `TenderDocumentsTab` without
  needing a separate unit-test layer for it.

This exercises the redesigned UI through the real upload API (against the test MinIO
bucket, same as any other file-upload integration test in this repo per `CLAUDE.md`'s
gotchas section), not a mocked one — consistent with how every other E2E spec here
works.

## Risks / edge cases

- **Long filenames** in the compact row have less horizontal room than the old card
  layout — truncate with an ellipsis (existing `truncate` pattern already used
  elsewhere in this component) and keep the full name in a `title` attribute.
- **Many-version types** (long expanded history list) inside the new tighter row
  container should still scroll with the page normally — no fixed-height container
  needed since this already works today.
- Reducing `DocumentUpload` to row-only styling means it can no longer stand alone as a
  "card" if some future caller wanted that; since it has exactly one caller today
  (confirmed via grep) and `packages/ui` components are meant to be reused/adapted per
  actual needs rather than kept maximally flexible up front, this is an acceptable
  trade-off rather than a regression.

## Rollout

Pure frontend change behind no feature flag — ships in the same PR as any other UI
change. Verify manually in the browser (tender with 0, 1, and multiple documents per
type) in addition to the new `tender-documents.spec.ts` E2E spec.
