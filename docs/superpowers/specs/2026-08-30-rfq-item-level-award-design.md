# RFQ Item-Level Award & Historical Vendor Rates — Design

## Context

Today, an RFQ is awarded as a whole: `Rfq.awardedVendorId` names one vendor,
and Purchase Order creation pulls that one vendor's quote for every item on
the RFQ, failing outright if that vendor didn't quote all of them. In
practice, different items on the same RFQ are commonly cheapest from
different vendors — the current model forces picking one vendor to lose
money on the rest, or manually splitting POs outside the app.

Separately, creating an RFQ from a tender's BOQ Items tab today only offers
"Send RFQ" — a quick-send shortcut (`apps/web/src/components/boq/send-rfq-dialog.tsx`)
that always creates a brand-new single-vendor RFQ and emails it immediately.
The full multi-vendor `/rfqs/new` page already supports everything needed
(multiple items, multiple vendors) but has no way to jump into it pre-scoped
to a tender.

This spec covers: per-item quote selection replacing whole-RFQ award,
multi-vendor PO creation from one RFQ, a `HistoricalRate` extension that
records which vendor won each item historically, and the UI changes across
the tender Items tab, the new-RFQ page, and the RFQ detail page.

## Goals

- Select a winning quote per RFQ item, independently, instead of one vendor
  for the whole RFQ.
- Create one Purchase Order per vendor in a single action, grouping an
  RFQ's items by their selected quote's vendor.
- Record the winning vendor + rate per item into `HistoricalRate` when an
  RFQ's rates are pushed to its tender, so future BOQ enrichment matching
  (which already reads `HistoricalRate`) can eventually surface "which
  vendor" alongside a suggested rate.
- Push selected rates from a closed RFQ back onto the originating tender's
  BOQ items, pre-filling (not locking) the existing editable rate cells.
- Replace the tender Items tab's "Send RFQ" quick-send with a "Create RFQ"
  button that opens the full `/rfqs/new` flow pre-scoped to the tender.
- Move the "send to a vendor" action itself onto the RFQ detail page's own
  action row, scoped to that RFQ, instead of living on the tender's BOQ grid.

## Non-goals

- Pre-carrying selected BOQ item ids into `/rfqs/new` via query param — only
  the tender is pre-filled; items are re-picked on that page, exactly as
  today's page already works once a tender is chosen.
- Changing how `HistoricalRate` powers BOQ enrichment matching (embedding
  similarity, `AI_MATCH_THRESHOLD`, `sameSpec()`) — this spec only adds
  vendor/traceability columns to the table; the matching logic in
  `boq-enrichment.service.ts` is untouched.
- A UI for browsing an item's full historical-quote list (the "rest of the
  quotes" the user can see later) beyond what's needed to prove the data is
  captured — surfacing that browsing UI is a natural follow-up, not
  required for this spec's own usefulness (pushing rates + recording
  history + selecting per item all work without it).
- Any change to `RfqVendor`/vendor-invite tracking beyond what's needed to
  relocate the send-to-vendor trigger onto the RFQ detail page.

## Data model

### `RfqQuote` — add `isSelected`

```prisma
model RfqQuote {
  // ...existing fields unchanged...
  isSelected Boolean @default(false)
}
```

Exactly one `RfqQuote` per `RfqItem` may have `isSelected = true` at a time.
Enforced in application logic, transactionally, the same way this codebase
already handles "current version" flags for Attachments and BOQ versions
(CLAUDE.md's documented convention: unset the prior flag and set the new
one in the same transaction) — not a DB constraint, since Prisma's schema
DSL can't express a partial unique index cleanly and this codebase already
has a working precedent for the app-level version of this pattern.

No migration needed for existing rows: `isSelected` defaults to `false`,
so existing quotes on already-closed RFQs simply start with nothing
selected until someone opens them and picks (or the one-time backfill
below runs).

### `Rfq` — drop `awardedVendorId`, drop `AWARDED` status

```prisma
model Rfq {
  // awardedVendorId field removed
  // RfqAwardedVendor relation removed
}
```

`RfqStatus` enum loses `AWARDED`. Remaining values: `DRAFT`, `SENT`,
`CLOSED`, `CANCELLED`. "Awarded" is no longer a stored state — it's derived
by checking whether every `RfqItem` on the RFQ has an `isSelected` quote.

**Migration note:** any RFQ currently in `AWARDED` status needs a
data migration step: set its status to `CLOSED`, and set `isSelected = true`
on the `RfqQuote` matching its (soon-to-be-dropped) `awardedVendorId` for
each of its items, before the column is dropped. This preserves today's
one existing award as the starting per-item selection rather than silently
losing it.

### `HistoricalRate` — add vendor + traceability + default flag

```prisma
model HistoricalRate {
  // ...existing fields unchanged...
  vendorId    String?
  vendor      Vendor?  @relation(fields: [vendorId], references: [id])
  rfqQuoteId  String?  @unique
  rfqQuote    RfqQuote? @relation(fields: [rfqQuoteId], references: [id])
  isDefault   Boolean  @default(false)
}
```

`isDefault` is scoped per `(businessId, itemName)` — same "only one flagged
at a time, transactionally" pattern as `RfqQuote.isSelected` above. Rows
with `vendorId = null` (manually-entered historical rates, not RFQ-sourced)
are unaffected by this flag and never auto-selected as default by this
feature — only RFQ-sourced pushes set `isDefault`.

## Backend changes

### RFQ service (`apps/server/src/modules/rfq/`)

- Delete `award()` and `setAwardedVendor()`.
- Add `selectQuote(rfqId, rfqItemId, quoteId, actorId, businessId)`:
  validates the quote belongs to that `rfqItemId` and business, then in one
  transaction unsets `isSelected` on any other quote for that `rfqItemId`
  and sets it on the given one.
- Add `pushRatesToTender(rfqId, actorId, businessId)`: requires
  `status === "CLOSED"`. For every `RfqItem` with both a `boqItemId` and a
  selected quote: update that `BoqItem.rate` to the quote's rate (plain
  field write, same as manual edit — no locking), and upsert a
  `HistoricalRate` row (vendorId, rate, itemName from the item's
  description, category inferred the same way existing historical-rate
  entry points do, `rfqQuoteId`, `isDefault: true` with the prior default
  for that itemName cleared in the same transaction). `RfqItem`s with no
  `boqItemId` (not sourced from a tender BOQ) are skipped, not an error.
- Vendor quick-send (today's `quickSend()`) stays as the implementation
  behind the RFQ detail page's relocated "send to vendor" action, just
  retargeted: instead of always creating a new RFQ, it becomes "invite this
  vendor to *this* RFQ and email them" — add a vendor invite
  (`RfqVendor`) to the existing `rfqId` rather than calling `create()`.
  (The tender-Items-tab entry point that used to trigger a brand-new RFQ is
  being removed per the UI changes below, so this method's one remaining
  caller is the relocated button.)

### Purchase Orders service (`apps/server/src/modules/purchase-orders/`)

`createFromRfq` changes from "single vendor, single PO, hard-fail if
incomplete" to: require `rfq.status === "CLOSED"` (replacing today's
`"AWARDED"` check — the backend enforces this, not just the frontend's
button gating), then group the RFQ's items by `selectedQuote.vendorId` and
create one PO per vendor group in one call, returning the list of created
POs. Items with no selected quote are excluded from every group (not an
error) — you can create POs for whichever vendors are ready even if one
item is still unresolved.

`CreatePurchaseOrderFromRfqInput` stays `{ rfqId, expectedDeliveryDate?,
notes? }` — no vendor param needed since grouping is automatic; the
response becomes a list of POs instead of one.

## Frontend changes

### Tender Items tab (`apps/web/src/components/boq/boq-item-grid.tsx`)

- Remove the `SendRfqDialog` trigger and its "Send RFQ" button.
- Add a "Create RFQ" button, enabled when ≥1 row is selected, that
  navigates to `/rfqs/new?tenderId=<tenderId>` (no item pre-carry, per
  Non-goals).

### New RFQ page (`apps/web/src/app/(dashboard)/rfqs/new/page.tsx`)

- Read `?tenderId=` via `useSearchParams` (matching the existing pattern
  in `apps/web/src/app/(dashboard)/bills/new/page.tsx`) and pre-select the
  tender dropdown when present. Manually changeable afterward, same as
  every other pre-filled dropdown in this app.

### RFQ detail page (`apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`)

- Quote comparison table: add a small selectable control next to each
  vendor's rate, per item row (radio-button semantics — at most one
  selected per item). Lowest non-regretted rate for that item is
  auto-selected only while no quote for that item has ever been explicitly
  selected yet; once a user picks one (including accepting the
  auto-pre-selected lowest by leaving it as-is triggers no write, but
  actively clicking any option does), a later new/updated quote never
  silently overrides that choice — the user's explicit pick always wins
  until they change it themselves. Selecting calls `selectQuote`.
- The existing bottom comparative-statement table is unchanged.
- Header action row: add the vendor-invite ("send to vendor") action here,
  scoped to this RFQ. Add "Push rates to tender" and change "Create
  Purchase Order" to reflect it may create several — both enabled once
  `status === "CLOSED"` (items don't all need a selection to attempt
  either; both operations skip unresolved items rather than blocking).
- Remove the standalone "Award RFQ" control (the vendor-select dropdown at
  the bottom of the page) entirely — replaced by per-item selection above.

## Testing considerations

- `isSelected`/`isDefault` transactional flip: unit-test that setting a new
  selection clears exactly one prior flag, never more, never fewer —
  mirrors existing tests for `isCurrent` on Attachments/BOQ versions.
- PO grouping: integration test with 3 items across 2 vendors (one vendor
  wins 2 items, the other wins 1) produces exactly 2 POs with the right
  item split; an item with no selection is excluded from both.
- Push-to-tender: integration test that a closed RFQ with 2 selected items
  (one with a `boqItemId`, one without) updates exactly the linked
  `BoqItem.rate` and creates exactly one `HistoricalRate` row, leaving the
  unlinked item's rate and any other tender's rates untouched.
- Migration: a test fixture representing a pre-migration `AWARDED` RFQ
  correctly ends up `CLOSED` with the right quote(s) marked selected.

## Open questions for the implementation plan

- Exact category inference for the `HistoricalRate` row written by
  push-to-tender (existing entry points already solve this somewhere —
  plan should locate and reuse that logic rather than re-deriving it).
- Whether `selectQuote`/push-to-tender need their own permission keys or
  reuse `rfq:update` — plan should check `packages/types/src/rbac.ts`'s
  existing RFQ permission keys before deciding.
