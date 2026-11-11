# Rate Finalization (RFQ → Tender → Item inventory) — Design

Date: 2026-11-11
Status: draft, awaiting approval
Part 1 of 2. Part 2 ("Submission history": per-submission snapshots + a human-readable change log
between submissions, entity code in the audit log) is a separate spec, brainstormed after this one
ships. This part must leave the data in a shape Part 2 can snapshot (see "Forward compatibility").

## Why

The owner prices a tender by collecting vendor quotes, picking the purchase rate per item, and adding
a margin. Today none of that reasoning is kept: the tender's rate column holds only the final number,
nobody can tell which vendor's quote it was built on, and when a tender is pulled back from Submitted
and resubmitted with different rates there is no record of what changed. The owner wants, as an admin,
to look back later and see *who* supplied the rate behind each item, *what* it was, and what the owner
quoted on top of it.

This part builds the rate trail itself. Part 2 builds the history/change-log on top of it.

## What exists today (verified 2026-11-11)

- `RfqQuote` (per RFQ item × vendor) already has `rate`, `regretted`, `make`, `model`, `quotedAt`,
  `remarks`, and an `isSelected` flag. `RfqItem.boqItemId` already links an RFQ line to a tender BOQ
  item. `RfqItem.itemId` links it to the canonical inventory `Item`.
- RFQ statuses: `DRAFT/SENT/CLOSED/CANCELLED`. "Close" finalizes; reopen exists.
- `RfqService.pushRatesToTender` (`apps/server/src/modules/rfq/rfq.service.ts`, button "Push rates
  to tender" on `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`): on a CLOSED RFQ, copies each
  selected quote's rate **directly into `BoqItem.rate`** (no margin, overwrites) and records a
  `HistoricalRate` row via `RatesRepository.recordFromRfqQuote`.
- `HistoricalRate` already carries `rate`, `effectiveDate`, `vendorId`, `rfqQuoteId` (unique),
  `sourceTenderId`, `isDefault` — but is keyed by free-text `itemName`, not `Item`. It also feeds the
  AI rate-matching (pgvector ANN in `boq-enrichment.service.ts`).
- Item detail page shows raw RFQ quotes per item via `RfqService.listItemPrices`.
- Tender Items tab (`boq-item-grid.tsx`): inline rate edit, plus a bulk "% adjustment" that multiplies
  the *current* rate of selected rows (compounding). Separate `BoqItemRateBreakdown` / rate-analysis
  dialog computes a rate from material/labour/etc. costs × overhead/profit/tax %.
- Tender status change (`TendersService.changeStatus`) logs `TENDER_STATUS_CHANGED` with
  `{from, to, remarks}`. Reverting a status is admin-only (`tenders:revert_status`), or the actor's own
  just-made change.
- **Bug:** RFQ "lowest rate per item" auto-selection. `RfqService.upsertQuote` auto-selects the cheapest
  quote only "while nothing has been explicitly selected yet" — but the first quote entered is itself
  auto-selected (cheapest of one), so every later, cheaper quote is ignored. The code can't tell its own
  auto-pick from a human pick. Vendor-total "Lowest" is computed separately and is correct.

## Goals

1. **Fix per-item lowest selection.** Each RFQ item auto-selects its lowest non-regretted quote, and
   keeps re-picking as quotes arrive or change, until a human explicitly selects one. A human pick is
   never overridden automatically.
2. **RFQ "Finalize rates".** One action on the RFQ page that (a) finalizes the RFQ (today's Close),
   (b) records vendor rates into the item inventory, linked to the RFQ, and (c) sets the **base rate**
   on the linked tender items. Replaces "Push rates to tender".
3. **Base rate + markup on tender items.** Each tender BOQ item shows, beside its rate: base rate,
   the vendor it came from (name, make/model, quote date, link to RFQ), and a markup %. When a base
   rate first arrives, markup defaults to **15%** and rate = base × 1.15 (rounded to 2 dp). Markup is
   editable per item and in bulk. Rate stays directly editable too.
4. **Tender "Finalize rates" lock.** A lock toggle on the tender Items tab. Locked = rates cannot be
   edited. Moving the tender to **Submitted requires rates to be locked.** The toggle can only be
   flipped while the tender is in **Draft**. To change rates on a submitted tender: revert to Draft
   (existing admin-gated reversal) → unlock → edit → lock → submit again.
5. **Submit asks for a submission reference number** (owner thinks of it as roughly the quotation
   number). Stored on the tender; prefilled on a later resubmission so it can be kept or changed; logged
   in the status-change audit entry.
6. **On Submit, the owner's rates go into the item inventory** as "my rate" for each item, tagged with
   the tender number. One row per (tender, item): resubmitting replaces that tender's row. Earlier
   values are preserved by Part 2's snapshots, not here.
7. **Item inventory rate history.** Each item's detail page shows two histories: vendor rates (vendor,
   rate, make/model, date, RFQ) and my rates (tender number, rate, base rate, markup, date). Nothing is
   ever deleted; the page shows the last **5 years** by default with a way to show all.

## Non-goals

- Submission snapshots, comparing submissions, human-readable change log, entity code column in the
  audit log — **Part 2**.
- GST split, purchase-order generation from selected quotes (the owner mentioned per-line POs as a
  future use; the per-item selection from Goal 1 is what it will build on — nothing PO-specific here).
- Deleting/archiving old rates. No retention job.
- A per-business configurable default markup. 15% is a constant.

## Anti-goals (failures even if it "works")

- A human's quote selection silently replaced by the auto-pick.
- Rates changing on a Submitted tender with no record (hence the Draft-only toggle rule).
- The owner's sell rates (with markup) leaking into the AI rate-suggestion pool, which today is
  built on purchase rates. AI matching must keep reading vendor rates only — no behaviour change there.
- Inventory showing draft rates that never went to a client (hence: my-rate written on Submit, not on
  Finalize).

## Behaviour detail

### A. Lowest-quote auto-selection

- Track per RFQ item whether its selection is automatic or manual.
- On any quote create/update/regret for an item whose selection is automatic: re-select the lowest
  non-regretted priced quote (or none if there isn't one).
- Explicit select via the existing select-quote action marks it manual.
- Existing data: items whose current selection came from a human have an `RFQ_QUOTE_SELECTED` audit
  row; backfill those as manual, everything else as automatic (and re-run the auto-pick for them, so
  existing RFQs are corrected).

### B. RFQ Finalize rates

- Button "Finalize rates" replaces both "Close" and "Push rates to tender" on the RFQ page. It does the
  close plus the writes below. Reopen (existing) is the unlock; finalizing again re-runs the writes and
  replaces the previous ones for that RFQ.
- Inventory writes: every vendor's priced quote, per item (see "Decided" below). Each row links to the
  RFQ (via the quote), the vendor, and the canonical `Item`.
- Tender writes (only if the RFQ is linked to a tender): for each RFQ item with a selected priced quote
  and a `boqItemId` that resolves to an item of that tender's **current** BOQ version, set base rate +
  base-rate source on the BOQ item. If the item had no markup yet, markup = 15%. Recompute rate and
  amount from base × (1 + markup). Items skipped (no selection, non-current BOQ version, regretted) are
  counted and reported back, as `pushRatesToTender` does today.
- If the tender's rates are **locked**, tender writes are skipped entirely and the result says so
  ("Tender rates are locked — unlock and finalize again to update base rates"). Inventory writes still
  happen.
- RFQs not linked to a tender: inventory writes only.

### C. Tender items: base rate and markup

- New per-item data: base rate, base-rate source (the `RfqQuote` it came from), markup %.
- Editing markup → rate = base × (1 + markup), amount recomputed.
- Editing rate directly on an item with a base rate → markup recomputed as rate/base − 1 (so the two
  never disagree). Items without a base rate behave exactly as today.
- The bulk "% adjustment" becomes **"Set markup %"** for selected items: sets the markup (absolute,
  not compounding) on items that have a base rate; items without one are skipped and counted in the
  toast.
- The rate-analysis dialog keeps working as today; if it writes a rate on an item with a base rate,
  markup is recomputed from it like any direct rate edit.

### D. Tender rates lock

- Stored on the tender (who locked, when). Toggle on the Items tab, styled as a lock switch.
- Toggle enabled only while status is DRAFT. Reverting SUBMITTED → DRAFT leaves it locked.
- While locked, the server rejects every rate-affecting write on that tender's current BOQ: rate,
  markup, base rate, quantity, add/delete item, bulk markup, rate analysis, committing a new BOQ
  version. (My call: quantity and item changes alter the submitted value just as much as rates.)
- Lock / unlock are audit-logged (`TENDER_RATES_LOCKED` / `TENDER_RATES_UNLOCKED`).
- Permission: same permission that edits BOQ rates today (no new RBAC key).

### E. Submit

- Any transition **to** SUBMITTED (from DRAFT or CANCELLED) requires rates locked; otherwise a clear
  400 telling the user to finalize rates first. The status tracker shows that instead of failing
  silently.
- The submit action opens a small dialog asking for the submission reference number (required),
  prefilled with the previous one if any. Stored on the tender; included in the
  `TENDER_STATUS_CHANGED` metadata.
- Just before the status write (an idempotent replace, so a failed status write is safely retried):
  for each current-BOQ item with a rate, resolve its `Item` (same exact
  canonical-name find-or-create rule already used by `items.service.ts#backfill` and
  `boq.service.ts#propagateHsnToItem`) and upsert one "my rate" row for (tender, item) with rate, base
  rate, markup, date.

### F. Item inventory

- Extend `HistoricalRate` rather than adding tables (my call): add a link to `Item` and a kind
  (vendor rate / my rate). Vendor rows keep `vendorId` + `rfqQuoteId`; my-rate rows carry
  `sourceTenderId`. AI rate matching filters to vendor rows only.
- Item detail page: "Vendor rates" and "My rates" sections, newest first, last 5 years by default,
  "Show all" to expand. My-rate rows link to the tender (showing tender number).
- Existing `HistoricalRate` rows have no `Item` link; backfilling them by canonical name is the
  builder's call (nice to have, not required).

## Forward compatibility with Part 2

Part 2 will hook the SUBMITTED transition (Behaviour E) to freeze a snapshot of every current-BOQ item:
rate, base rate, base-rate source vendor, markup, quantity, plus the reference number. Keep those as
plain readable fields on the BOQ item / tender so the snapshot is a straight copy — no derived-only
values that would need recomputing later.

## Decided: every vendor's quote is recorded

On RFQ finalize, the inventory records **every vendor's priced (non-regretted) quote** for each item,
one row per quote, each linked to its vendor, RFQ and `Item` — not just the selected one. The selected
quote's row is the one marked `isDefault` (today's meaning, so the AI rate matching sees the same
"chosen purchase rate" it does now). The item page's Vendor rates section replaces the existing raw-quote
list (`listItemPrices`) there. The owner plans small charts of vendor rates over time later — keep rows
plain (vendor, item, rate, date) so that is a straight query; the charts themselves are out of scope.

## Calls made in this document (not the owner's — flag if wrong)

- Multiple finalized RFQs feeding the same tender item: the most recent finalize wins; the base-rate
  source shows which RFQ/vendor.
- Reopening an RFQ leaves the tender's base rates and inventory rows as they are until it is
  finalized again.
- Submission reference number: required for `TENDER` kind, optional for `BUDGETARY`.
- Migration: existing tenders not in DRAFT are marked rates-locked, so the "Submitted ⇒ locked" rule
  holds for old data.
- Lock covers quantity/item add/delete/new BOQ version, not just the rate column.
- `HistoricalRate` extended rather than new child tables.

## Left to the builder

- Exact column names, enum names, index/unique strategy for "one my-rate per (tender, item)".
- Whether the "selection is manual" flag lives on `RfqItem` or `RfqQuote`.
- Lock-switch visual design (shadcn `Switch` with a lock icon is fine).
- How the skipped-item counts are worded in toasts.
- Test split, following repo conventions (Vitest unit tests with fake repositories; one integration
  test covering lock → submit gating is worthwhile since it crosses tenders + BOQ).
