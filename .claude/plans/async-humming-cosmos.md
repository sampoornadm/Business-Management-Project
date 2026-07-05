# Integrate BOQ items into the tender view, add item CRUD, reduce statuses

## Context

Three related pain points surfaced after using the app for real tenders:

1. **No way to add items when creating a tender manually** (without uploading a
   document) — items only ever get in via the document-extraction flow built
   earlier, or the separate BOQ upload/parse/commit flow. There's no direct
   "type in an item" path at all.
2. **BOQ lives on a separate page reached via a header button**
   (`/tenders/[id]/boq`), not alongside the tender detail view's
   Overview/Documents/Assignees/Competitors/History tabs. It should be one of
   those tabs, and that panel should support ad-hoc add/edit/delete of
   individual items — not just the existing "upload a spreadsheet and commit
   a whole new version" flow.
3. **14 tender statuses is too many** for how this business actually works.
   Reduce to 5: **Draft, Submitted, Won, Lost, Cancelled** — collapsing every
   internal prep stage (Upcoming/Document Collection/Under Study/BOQ
   Preparation/Rate Analysis/Approval Pending) into Draft, and both
   post-submission qualification stages (Technically/Financially Qualified)
   into Submitted. No separate Archived — Won/Lost/Cancelled are already
   terminal.

Items #1 and #2 are the same underlying gap: once a proper "Items" tab with
real add/edit/delete exists, the answer to "how do I add items from scratch"
is simply "create the tender, then add items one by one in its Items tab" —
no change needed to the New Tender page itself.

## What already exists (confirmed by reading the code — reuse, don't rebuild)

- `PATCH /boq-items/:itemId` (`boq.routes.ts:203-209`, `updateBoqItemSchema` in
  `boq.validation.ts:23-34`) **already accepts itemCode/description/category/
  unit/quantity/rate/remarks** — the backend already supports editing every
  field. Only the frontend (`boq-item-grid.tsx`) currently wires up
  `quantity`/`rate` as editable columns; description/unit just aren't marked
  `editable: true` yet.
- `BoqItemGrid` (`apps/web/src/components/boq/boq-item-grid.tsx`) already uses
  `EditableTreeTable` with inline-editable cells, row selection, and a
  `renderRowActions` slot (currently the rate-analysis dialog button) — the
  natural place to add a delete button.
- `TenderBoqPage` (`apps/web/src/app/(dashboard)/tenders/[id]/boq/page.tsx`)
  already has all the display logic (status badge, version count, total,
  compare link, finalize button, upload-new-version) — this content moves
  into a new tab component, not rebuilt.
- `boq.service.ts`'s existing mutations (`updateItem`, `bulkUpdateItems`) all
  follow the same pattern: mutate via `boqRepository`, `auditService.log(...)`,
  return `this.buildBoqDto(boqId)` (the full item tree) — `addItem`/
  `deleteItem` follow this exact pattern.
- `tender-stepper.ts`'s `buildTenderSteps`/`isOnHappyPath` are already fully
  generic over whatever `TENDER_HAPPY_PATH` array they're given — just needs
  the array updated to the new 5-status set, no logic changes.

## What's missing (net-new)

- No single-item **create** or **delete** endpoint — only `findItemById`/
  `updateItem`/`bulkUpdateRates` exist on `IBoqRepository`
  (`boq.repository.ts:72-85`). Adding or deleting one item today means
  re-committing the entire item list as a new BOQ *version*, which would
  version-bomb the BOQ history for what should be lightweight edits.

## Design

### 1. Item-level create/delete (server)

- `IBoqRepository` (`boq.repository.ts`): add `createItem(boqId, data):
  Promise<BoqItemWithBreakdown>` and `deleteItem(id): Promise<void>` —
  same shape/style as the existing `updateItem`.
- `boq.validation.ts`: add `createBoqItemSchema` (same fields as
  `updateBoqItemSchema` minus the "at least one field" refinement;
  `description` required, everything else optional — mirrors
  `CommitBoqItemInput`'s shape).
- `boq.service.ts`: add `addItem(tenderId, data, actorId)` — asserts the
  tender has a current BOQ (reuse `getCurrentBoq`'s not-found message if it
  doesn't — a tender needs *some* BOQ to add into; if none exists yet, the
  first "add item" call also creates BOQ version 1 via the existing
  `boqRepository.createBoq`, so a from-scratch tender never needs the
  upload/commit flow at all), computes `amount` the same way `updateItem`
  does, logs `BOQ_ITEM_ADDED`, returns `buildBoqDto`. Add
  `deleteItem(itemId, actorId)` — same pattern, logs `BOQ_ITEM_DELETED`.
- `boq.routes.ts`: `POST /tenders/:id/boq/items` (permission `boq:create`,
  nested like `/parse`/commit) and `DELETE /boq-items/:itemId` (permission
  `boq:update`, alongside the existing single-item routes on
  `createBoqItemsRouter`).
- `boq.controller.ts`: `addItem`/`deleteItem` actions, same
  `asyncHandler`/`sendSuccess` shape as every other action in the file.

### 2. Frontend: fold BOQ into a tender-detail tab with full CRUD

- New `apps/web/src/components/tenders/tender-items-tab.tsx`, following the
  exact convention of `tender-documents-tab.tsx`/`tender-assignees-tab.tsx`
  (self-contained, takes `tenderId`/`tender` props, owns its own queries).
  Body is `TenderBoqPage`'s current content (status badge, version/total,
  compare link, finalize, upload-new-version, `BoqItemGrid`) — moved, not
  rewritten. Add an "Add item" row above the grid (inline form: description
  input + unit/quantity, submits via a new `useAddBoqItem(tenderId)` hook).
- `boq-item-grid.tsx`: mark `description`/`unit` columns `editable: true`
  (wired through the same `commitField`-style pattern already used for
  quantity/rate — no backend change needed, per above). Add a delete button
  to `renderRowActions` next to the existing rate-analysis button, calling a
  new `useDeleteBoqItem(tenderId)` hook.
- `use-boq.ts`: add `useAddBoqItem(tenderId)` (`POST
  /tenders/:id/boq/items`) and `useDeleteBoqItem(tenderId)` (`DELETE
  /boq-items/:itemId`), both invalidating the same `["tenders", tenderId,
  "boq"]` query key `useCommitBoq`/`useUpdateBoqItem` already use.
- `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`: add an `"items"`
  `TabsTrigger`/`TabsContent` next to Overview/Documents/Assignees/
  Competitors/History, rendering `<TenderItemsTab tender={tender} />`.
  Remove the standalone header "BOQ" button (`Link` to `/tenders/:id/boq`)
  — the tab replaces it.
- Delete `apps/web/src/app/(dashboard)/tenders/[id]/boq/page.tsx` (content
  now lives in the tab). **Keep** `boq/compare/page.tsx` as-is — comparing
  against another tender is a distinct, occasional action, not part of the
  everyday items panel; link to it from inside the new tab exactly like
  today.
- This directly answers "how do I add items from scratch": create the
  tender (any path, no document needed), open its **Items** tab, use "Add
  item" — no separate upload required. The document-upload one-shot flow
  from earlier is now just a shortcut that pre-populates this same tab.

### 3. Status reduction: 14 → 5

**New set**: `DRAFT`, `SUBMITTED`, `WON`, `LOST`, `CANCELLED`.

- `packages/database/prisma/schema.prisma`: shrink the `TenderStatus` enum to
  the 5 values.
- **Migration** (`prisma migrate dev --create-only`, then hand-edit the SQL —
  Postgres can't drop enum values in place, and live data uses removed
  values today: verified via `docker compose exec postgres psql` — current
  DB has rows in `UPCOMING`(4), `BOQ_PREPARATION`(1), `RATE_ANALYSIS`(1)
  alongside `DRAFT`(3)/`WON`(3)). Migration must, in order: (1) `UPDATE
  tenders SET status = 'DRAFT' WHERE status IN ('UPCOMING',
  'DOCUMENT_COLLECTION','UNDER_STUDY','BOQ_PREPARATION','RATE_ANALYSIS',
  'APPROVAL_PENDING')`, (2) `UPDATE tenders SET status = 'SUBMITTED' WHERE
  status IN ('TECHNICALLY_QUALIFIED','FINANCIALLY_QUALIFIED')`, (3) `UPDATE
  tenders SET status = 'CANCELLED' WHERE status = 'ARCHIVED'` (defensive;
  0 rows today), all while the column is still `text`/old enum — then the
  standard Postgres rename-recreate-cast dance to shrink the enum type
  itself. Same treatment for `TenderStatusHistory.status` if that table
  stores the enum too (check during implementation).
- `packages/types/src/tender.ts`: `TENDER_STATUSES` → 5 values;
  `TENDER_STATUS_LABELS` trimmed to match; `TENDER_STATUS_TRANSITIONS`
  simplified to `DRAFT: [SUBMITTED, CANCELLED]`, `SUBMITTED: [WON, LOST,
  CANCELLED]`, `WON: []`, `LOST: []`, `CANCELLED: []`; drop
  `TENDER_TERMINAL_STATUSES`'s `ARCHIVED` entry.
- `apps/web/src/lib/tender-stepper.ts`: `TENDER_HAPPY_PATH` → `[DRAFT,
  SUBMITTED, WON]` (unchanged logic, per above).
- `apps/web/src/lib/tender-status.ts`: drop the removed-status `case`s from
  `tenderStatusBadgeVariant`'s switch (the `default` already covers it
  safely, this is just cleanup for clarity).
- `apps/web/src/components/tenders/status-change-dialog.tsx`: no logic
  change expected (verify during implementation) — it already derives its
  options from `TENDER_STATUS_TRANSITIONS`/`TENDER_STATUS_LABELS`.
- RBAC (`rbac.ts`), seed script: scan for any hardcoded references to a
  removed status value (e.g. a seed fixture explicitly using
  `BOQ_PREPARATION`) and update to a kept one.

## Non-goals

- Not rebuilding the BOQ versioning/finalize/compare mechanics — untouched.
- Not adding a generic "archive" flag/filter to replace the dropped
  `ARCHIVED` status — not requested; Won/Lost/Cancelled are sufficient
  terminal states for now.
- Not touching the document-upload one-shot extraction flow from the
  previous change — it still works exactly as before, just now feeds into
  the relocated Items tab instead of a standalone BOQ page after redirect.

## Verification

1. `pnpm --filter @bmp/server typecheck`/`test`, `pnpm --filter @bmp/web
   typecheck`.
2. Apply the new migration to the running dev Postgres; confirm via `psql`
   that all previously-`UPCOMING`/`BOQ_PREPARATION`/`RATE_ANALYSIS` rows are
   now `DRAFT` and no rows reference a dropped enum value.
3. Real end-to-end: create a tender with no document, open its Items tab, add
   two items by hand, edit one's description/quantity/rate inline, delete
   one, confirm the BOQ total updates and no new BOQ *version* was created
   for these single-item edits (still version 1).
4. Confirm the header no longer has a separate "BOQ" button, the tab order is
   Overview/Items/Documents/Assignees/Competitors/History (or similar), and
   `/tenders/:id/boq` (old route) is gone while `/tenders/:id/boq/compare`
   still works from a link inside the tab.
5. Confirm `StatusChangeDialog` only offers Draft→Submitted/Cancelled and
   Submitted→Won/Lost/Cancelled — no leftover 14-state options anywhere in
   the UI (stepper, badges, filters on the tenders list page).
