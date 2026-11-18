# Submission History & Change Log — Design

Date: 2026-11-12
Status: approved 2026-11-12
Part 2 of 2. Part 1 (rate finalization: RFQ "Finalize rates", BOQ base rate + markup, tender rates
lock, submission reference, own/vendor rate history) shipped to `main` 2026-11-11 — see
`docs/superpowers/specs/2026-11-11-rate-finalization-design.md`.

## Why

A tender is often submitted, pulled back to Draft, re-priced and submitted again. As an admin the
owner wants to look back later and see, for each submission: when it went out, under which
reference number, and — in plain words — what changed since the previous submission: which item
rates moved, which vendor's rate they were built on before and after, and other differences that
matter for a bid (HSN codes, vendors' technical deviations). Today the tender's History tab only
says "Draft → Submitted" with a remark, and the Audit Log shows a raw entity UUID and no details.

## What exists today (verified 2026-11-12)

- `TendersService.changeStatus` logs `TENDER_STATUS_CHANGED` (`{from, to, remarks,
  submissionReference}`) to `AuditLog`. A "fresh" submission (from DRAFT/CANCELLED) requires rates
  locked and (TENDER kind) a reference; it writes the owner's rates (`recordOwnRates`). **Bug to
  remove:** WON/LOST → SUBMITTED currently also re-runs `recordOwnRates`, re-saving the owner's
  rates with today's date — the owner wants that move to record only the status change.
- Each current-BOQ `BoqItem` carries description, unit, quantity, rate, amount, `baseRate`,
  `markupPercent`, `baseRateQuoteId` (→ `RfqQuote` → vendor), `hsnCode`, `gstRate`.
- `RfqQuote.remarks` holds the vendor's free-text reply; it only arrives through the Excel quote
  sheet import (column header "Remarks", also printed on the RFR Word/PDF). The RFQ page does not
  show it anywhere.
- Tender History tab (`tender-history-tab.tsx`) = filtered `AuditLog` read via
  `TendersService.getStatusHistory`: who, when, from → to, remarks.
- Settings → Audit Log: one global table (AuditLog has no `businessId`; `audit:read`), columns Actor,
  Action, Entity Type, Entity ID (raw UUID, hidden by default), IP, When. Metadata is not shown.
  Audited entity types in use: Tender, User, BoqItem, Item, Rfq, Organization, PurchaseOrder,
  Vendor, Bill, Project, Business.

## Decisions (the owner's)

1. Each **fresh submission** is recorded as a numbered submission (#1, #2, …) with its time, actor,
   reference number and a frozen copy of the tender's pricing.
2. The change log compares a submission **only with the immediately previous one**.
3. It is readable in **both** places: the tender's History tab and the global Audit Log.
4. The Audit Log shows each event's **entity code** (the tender number for tender events) next to
   its entity type.
5. Tracked from day one: item **rates** and the **vendor** behind each rate, **HSN codes**, and
   **technical deviations**.
6. **Technical deviation** = the RFQ quote's existing Remarks, renamed "Technical deviation (if any)"
   everywhere it appears. Anything that only means "none" ("No", "NA", "N/A", "Nil", "None", "-",
   blank, "No deviation", …) is treated as no deviation and not stored. The owner will revisit the
   RFQ page as a whole later.
7. When an item's base rate comes from a vendor's quote, **that vendor's** deviation (only theirs)
   shows on the tender's item row.
8. WON/LOST → SUBMITTED is logged as exactly that status change — **not** a new submission.

## Goals

### A. Technical deviation
- Rename the quote's remarks to technical deviation in: the quote sheet column header
  ("Technical deviation (if any)"), the RFR Word/PDF column header, API/DTO field names, and the
  importer.
- Normalise on every write (sheet import and API): trim; if what is left is empty or is a "none"
  phrase, store null. The "none" list is matched on the whole text, case-insensitive, ignoring
  surrounding punctuation/whitespace: `no`, `na`, `n/a`, `n.a.`, `nil`, `none`, `nill`, `-`/`--`,
  `not applicable`, `no deviation`, `no deviations`, `no deviation from spec(ification)(s)`,
  `nd`. Existing rows are normalised the same way by migration.
- Tender items grid: on a line with a base rate, the base-rate cell shows the source quote's
  deviation (a small warning marker + the text, e.g. on hover/expand) when it has one.
- RFQ page: a quote cell with a deviation shows a small marker with the text on hover (read-only).

### B. Submissions
- On a fresh submission (rules below), after the existing checks and own-rate recording, store a
  `TenderSubmission`: tender, business, number (1, 2, … per tender), reference, submitted at/by,
  total amount, an item snapshot, the structured changes vs the previous submission, and the
  readable summary text.
- **Fresh submission** = move to SUBMITTED from DRAFT; or from CANCELLED when the tender has no
  submission yet (cancelled straight from Draft). CANCELLED → SUBMITTED for a tender that already
  has submissions (undoing a cancel), and WON/LOST → SUBMITTED, are plain status changes: no new
  submission, and the owner's rates are **not** re-saved — the only record is the
  `TENDER_STATUS_CHANGED` audit row (e.g. "Won → Submitted").
- **Item snapshot** (per current-BOQ line, leaf lines only): BOQ item id, description, unit,
  quantity, rate, amount, base rate, markup %, base-rate vendor id + name, HSN code, technical
  deviation (the base-rate quote's, as it was at submission).
- **Matching lines** between two snapshots: by BOQ item id; lines left unmatched are then matched by
  exact description + unit (a re-uploaded BOQ version gets new ids); anything still unmatched is
  "added" or "removed".
- **Changes detected** (vs previous submission): reference number; total; per matched line —
  rate (with vendor before → after), markup %, base rate, vendor, quantity, HSN code, technical
  deviation; lines added; lines removed. If nothing differs: "No changes since #N".
- **Readable summary** (stored text, generated once at submission, shown verbatim):

  ```
  Submission #2 · ref ABC/124 (was ABC/123) · total ₹11,95,500 (was ₹12,40,000)
  Rates changed (2):
  • XLPE Cable 4C×16 — ₹437.00 → ₹415.00 · Polycab Traders → Havells Dist. · markup 15% → 15%
  • GI Pipe 50mm — ₹1,150.00 → ₹1,180.00 · markup 15% → 18%
  HSN changed (1):
  • XLPE Cable 4C×16 — 8544 → 85444999
  Technical deviation changed (1):
  • XLPE Cable 4C×16 — none → "Make KEI instead of Polycab"
  Quantity changed (1):
  • GI Pipe 50mm — 120 → 140 m
  Added (1): • Cable gland 25mm
  Removed (1): • Cable tray 300mm
  ```

  First submission: `Submission #1 · ref ABC/123 · 14 items · total ₹12,40,000`.
- The submission's summary also goes into the `TENDER_STATUS_CHANGED` audit row's metadata
  (`submissionNumber`, `summary`) — not the item snapshot, which stays in `TenderSubmission` so
  audit reads stay small.

### C. Where it shows
- **Tender History tab**: each status entry that created a submission shows "Submission #N · ref …"
  and expands to the readable summary. Other entries unchanged.
- **Audit Log**: a new **Entity** column showing the entity code (sortable/filterable as text,
  visible by default), and a **Details** column showing `metadata.summary` when present (truncated
  to one line, full text on expand). Any future event may set `metadata.summary` to appear there.
- **Entity code** is stored on the audit row at write time (`AuditLog.entityCode`), resolved inside
  `AuditService.log` from `entityType` + `entityId` when the caller doesn't pass one, so all ~100
  existing call sites get it with no edits:
  Tender → tender number; BoqItem → its tender's number; Item → item code (canonical name if no
  code); Rfq → title; PurchaseOrder → PO number; Bill → bill number; Vendor / Organization /
  Project → name; Business → code; User → email. Unknown type or missing row → null.
  Existing rows are backfilled by migration with the same mapping. Stored (not resolved on read)
  so the code survives the entity being deleted and the global audit page needs no cross-business
  lookups.

## Non-goals

- Comparing two non-adjacent submissions.
- Snapshotting anything on WON/LOST → SUBMITTED or undo-of-cancel.
- A technical-deviation editor on the RFQ page (sheet import + API only for now; RFQ page is being
  revisited separately). Deviations from vendors who are not the base-rate vendor are not shown on
  the tender.
- Tracking changes to fields not listed above (GST %, unit weight, remarks on BOQ items, notes…).
  The diff should be easy to extend with a field later.
- Exporting or printing the change log.

## Anti-goals

- A real deviation silently dropped because it starts with "No" ("No ISI mark on supplied make")
  — the "none" list matches whole text only.
- A submission whose summary claims changes that didn't happen (e.g. every line "changed" because a
  re-uploaded BOQ has new ids) — hence the description + unit fallback match.
- Audit Log pages slowed down by large item snapshots — snapshots live in their own table.
- Editing past submissions. Stored submissions are never rewritten.

## Constraints

- Follow repo conventions (CLAUDE.md): module layout, `requirePermission`, Zod, fakes not mocks,
  `pnpm db:migrate:create` then hand-edit SQL (strip any generated DROP INDEX on `*_hnsw_idx`).
- `TenderSubmission` is business-scoped: add it to `SCOPED_MODELS` in `scoped-client.ts`, and
  every read filters by `businessId`.
- Submission write happens in `changeStatus` after own rates are recorded and before the status
  write's notifications; a failure must not leave a half-written submission (single insert).

## Calls made in this document (not the owner's — flag if wrong)

- Snapshots in a dedicated `TenderSubmission` table instead of inside AuditLog metadata (the repo
  convention for status history) — snapshots can be hundreds of lines and would bloat every audit
  read.
- Fresh-submission rule for CANCELLED (above).
- Line matching by id, then description + unit.
- Entity code stored at write time with a resolver in `AuditService.log`, plus a backfill.
- Code field: rename `RfqQuote.remarks` → `technicalDeviation` in code with `@map("remarks")` so
  the DB column keeps its name (no data copy).
- Deviation shown read-only on the RFQ quote cell; no editor yet.
- Leaf BOQ lines only in snapshots (parent/heading rows carry no price).
- No snapshots are invented for submissions made before this ships (past pricing can't be
  reconstructed): a tender already Submitted today gets its #1 on its next fresh submission.
- A submission undone moments later (the tracker's Undo toast, SUBMITTED → DRAFT) keeps its record;
  the next submission is #2 and compares against it. History is never rewritten.

## Left to the builder

- Exact table/column names, the JSON shape of snapshot and changes (typed in `@bmp/types`).
- Money/number formatting in the summary (reuse the web's Indian-grouping formatter logic on the
  server, or a small shared helper).
- UI details of the expand/collapse and the deviation marker.
- Test split per repo conventions; the diff/summary generator should be a pure function with its
  own unit tests.
