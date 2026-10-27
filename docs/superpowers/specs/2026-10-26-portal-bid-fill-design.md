# SAIL ISP portal bid fill - design

Date: 2026-10-26. Status: draft for approval. First target: tender 1400014359, business SAMSON.

## Intent

Bids for SAIL ISP are submitted on `srm.sailisp.co.in` (an SAP SRM Web Dynpro portal run by mjunction). Today the user retypes into it data BMP already holds. Build a tool that fills the two data-entry pages of an RFx **response** from the BMP database, so the user only reviews and clicks Save/Submit.

Pages in scope:
- **Questions** (RFx Information > Questions): about 45 vendor-qualifying questions.
- **Items / Conditions**: price, CGST/SGST/IGST per item.

Also captured: the portal's **response number** (header "Number", e.g. 8100095724), stored as our bid reference. SAIL's price-opening mail carries only that number, not the tender number.

## Goals

- Fill both pages from BMP data in under a minute, then read every field back and report any mismatch.
- Keep three kinds of data apart: same for every tender of a business, same for every SAIL bid of a business, specific to one tender or item.
- Store the response number so a price-opening mail can be traced to its tender with one lookup.
- Build the page-driving layer so a later read-only workflow (competitor prices after opening) can reuse it.

## Non-goals and anti-goals

- **Never click Save, Check or Submit.** Bids are binding and irreversible. The user does that.
- No document uploads in v1 (the Notes and Attachments tab).
- No creating the response on the portal. The user creates it (Edit on the RFx); the tool attaches to it.
- No portal username or password stored anywhere. The user logs in to their own Chrome.
- No other buyers or portals in v1. The design must not need rework to add one.
- Competitor-price capture is a later workflow. Do not build it now.
- Anti-goal: a fill that looks complete but silently skipped or mistyped a field. Every field is read back and diffed.

## Findings that fixed the approach

- Replaying the portal's HTTP calls is not viable. Every action is a POST to one `/sap/bc/webdynpro/...` endpoint with a `sap-wd-secure-id`, server-side session state and an event queue. Control ids (`WD0979`) change per session.
- Combo boxes are type-ahead. Each keystroke sends `ComboBox_ListAccess`; leaving the field sends `ComboBox_Change`. Typing real keys works; setting `.value` or running a plugin does not.
- Inside the DOM, each label carries `f="<inputId>"` pointing to its input. Labels are stable, ids are not, so fields are found by label text.
- Item rows carry Product ID (e.g. `71802001600160`), which should equal `BoqItem.itemCode`. Price is entered on the Conditions tab (the Items tab "Price" cell is a "See Conditions" link).

## Approach

Playwright attaches over CDP to a visible Chrome the user started with `--remote-debugging-port` and logged in to. It types with real key events, Tabs to commit, picks combo-box entries and clicks radios by label.

Two layers:
- `PortalSession` (generic): attach, find a field by label, write a value by widget type (text, combo, radio), read a value, read a grid row, read the header "Number". No bid knowledge.
- Workflows on top: `fill-bid` now; `capture-opening` later (read only).

Entry point v1: CLI `pnpm portal:fill --tender 1400014359 [--dry-run]`. A web button later. `--dry-run` prints the full intended answer set, with the source of each value, and touches nothing.

## Data model

New or changed in `packages/database/prisma/schema.prisma`:

- `Tender.deliveryPeriodDays Int @default(120)`: the period we offer, in days after PO receipt. Editable on the tender.
- `BoqItem.unitWeightKg Float?`: optional unit weight, used for the consignment weight (see below).
- `PortalBid` (new): `id`, `businessId`, `tenderId`, `portalCode` (`SAIL_ISP`), `responseNumber` (unique per `portalCode`, indexed), `status` (SAVED / SUBMITTED / OPENED), `submissionDeadline`, `totalValue`, `lastFilledAt`, `lastFillSummary` (Json: fields set, mismatches, warnings). This table later also holds opening results.
- `PortalProfile` (new): `businessId`, `portalCode`, `answers Json`: the "same for every SAIL bid of this business" layer, keyed by question key. Unique on (`businessId`, `portalCode`).

The "same for every tender" layer is not a new table: it comes from `Business` and its primary `BusinessContact` (GSTIN, PAN, Udyam number, address, state, email, phone, contact person). Fields missing there (GeM vendor id, MSE sub-status, caste) go into the `PortalProfile.answers` Json rather than widening `Business`.

New RBAC key `tenders:fill-portal` (assigned in `packages/types/src/rbac.ts`). Needs `pnpm db:seed` on every environment. A schema migration is required (`pnpm db:migrate:create`), then `pnpm db:generate`.

## Question catalog

A code file `modules/portal-bid/sail-isp.questions.ts`: one entry per question: `key`, label matcher (exact text or regex on the portal label), widget (`text` / `combo` / `radio`), and a value source:
- `business`: a function over `Business` + contact.
- `profile`: a key in `PortalProfile.answers`.
- `tender`: derived from the tender, below.

Adding another buyer later means a new catalog file, nothing else.

### Per-tender derived values

- **HSN code**: the distinct non-empty `hsnCode` values across the current BOQ items, in BOQ order (`sortOrder`), joined with `, `. One distinct value gives that value alone. Items with no HSN are skipped and listed in the warnings.
- **Consignment weight**: Σ (quantity × `unitWeightKg`) over current BOQ items, rounded up to the next 10 Kg, written as `<n> Kg` (the user's rule, 2026-10-27). If any item has no `unitWeightKg`, the field is left untouched and reported.
- **Delivery period (days)**: `Tender.deliveryPeriodDays`.
- **Tender-stated delivery days**: not stored. A pure function `parseDeliveryDaysFromNotes` reads the tender's notes (all notes: `Tender.notes` including pinned lines) and returns the days if a delivery period is stated (days, weeks and months converted), else `null`. Delivery periods are rarely stated. If the parsed value is shorter than `deliveryPeriodDays`, the tender shows a "check delivery period" badge, and the fill prints the warning and asks for confirmation before typing a period longer than the tender allows. Computed on read so it can never go stale.

## Items page

For each current BOQ item, find the portal row by Product ID = `itemCode`, then on Conditions:
- Price: amount = `BoqItem.rate`, per 1, unit from the row.
- GST: if the supplier's GSTIN state code (first two digits) equals the billing party's, CGST = SGST = `gstRate / 2` and IGST 0; otherwise IGST = `gstRate`, CGST and SGST 0. Billing party GSTIN comes from the profile layer.
- All other charge conditions stay at 0.
- A BOQ item with no portal row, or a portal row with no BOQ item, aborts that item and is reported, never guessed.
- After filling, read back the portal's Total Value and compare with Σ (quantity × rate). Report a mismatch.

## Flow

1. User opens the response on the portal (Edit) in the debug-port Chrome.
2. `pnpm portal:fill --tender <number>`. The tool attaches, reads the header "Number" and RFx number, and checks the RFx number equals the tender number (abort if not).
3. Build the answer set, print it with sources and warnings; wait for confirmation unless `--yes`.
4. Fill Questions, then Items/Conditions.
5. Read back everything, print mismatches, upsert `PortalBid` (response number, deadline, total value, summary), write an audit log entry (`TENDER_PORTAL_FILL_COMPLETED`, counts and mismatches, never cookies or ids from the session).
6. Stop. The user reviews and saves.

## Error handling

- Portal not reachable on the debug port, or the page is not an RFx response: clear message, no partial state.
- A label not found: that field is reported as "not found" and skipped; the run continues and ends with a non-zero exit.
- A combo-box value not offered by the portal: reported, left unchanged.
- Any read-back mismatch is a failed run, not a warning.

## Testing

- Vitest unit tests (fake repositories, no mocking framework) for: HSN joining and de-duplication, weight sum and missing-weight handling, CGST/SGST vs IGST selection, delivery-period parsing from notes (days, weeks, months, none), catalog source resolution, response-number upsert.
- A fixture HTML of the Questions page and the Conditions grid (saved from the capture, personal data removed) for `PortalSession` read/find tests, without a live portal.
- Manual: `--dry-run` on 1400014359, then a live fill on the already-saved response 8100095724 and compare against the screenshots. `pnpm typecheck && pnpm lint && pnpm test` clean.

## Left to the builder

- Exact label matchers for the ~45 questions (derive from the capture; labels contain typos such as "avaialble" that must match as written).
- Where the CLI lives (`apps/server/src/scripts/` follows existing script conventions).
- Key-event pacing for combo boxes so the type-ahead round trips finish.

## My calls (change any)

- HSN de-duplicated, first-occurrence order, when several items share a code.
- Weight is derived from a new optional `BoqItem.unitWeightKg`; the user will need to enter unit weights.
- Tender-stated delivery days are parsed on read, not stored.
- GST split decided by GSTIN state code, not by comparing state names.
- Supplier-only fields not found on `Business` live in `PortalProfile.answers`.

## Still unknown

- The Basic Data, Payment and Summary subtabs were not captured; assumed no data entry needed there.
- Multi-item tenders: the Conditions grid is assumed to repeat the "Item n - <id>" group per item, as seen for one item.
- The IGST branch has not been seen on the portal.
