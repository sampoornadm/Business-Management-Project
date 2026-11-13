# Competitor rates from the SAIL ISP comparative statement

Date: 2026-11-14. Status: awaiting approval.

## Why

When SAIL opens a tender, its portal publishes a comparative statement: every bidder, their
answers, and their rate for every item. It is the only place competitors' prices are ever visible,
and today it is read by eye and forgotten. The owner wants it captured every time, so that when
pricing a later tender with the same items they can see who is likely to bid, what rate they need
to beat, and where their own rate is heading.

## What was learned from a real statement

A throwaway capture of RFx 1400000013 (coil spring, 5 bidders) showed:

- Address: `{PORTAL_URL}/irj/servlet/prt/portal/prtroot/pcd!3aportal_content!2fIISCO!2fIISCO_Iview!2fzsrm_dashboard_0?P_OBJ_ID=<RFx number>`.
  It needs the logged-in portal session; a plain HTTP client is refused.
- The page is an SAP WebGUI ALV grid (transaction ZSRM042) inside one iframe
  (`.../sap/its/webgui`). All five bidder columns were in the DOM even though only two were on
  screen. No PDF, no download needed. An "Microsoft Excel" export button exists as a fallback.
- Layout is transposed: one row per field, one column per bidder. Three blocks:
  - RFQ details: RFQ no, description, bid start/end, basis of evaluation, payment terms.
  - Header level, per bidder: supplier `( vendor code ) NAME`, submitted by, quotation reference
    no, MSE status, delivery days, incoterms, technical deviation, validity, `Total LCNITC(As Quoted)`.
  - Item level, per bidder: Sl No, Item Code, Item Description, RFQ Item Quantity, Offer Quantity,
    Item UoM, currency, Price as quoted, IGST/CGST/SGST, Landed Cost, Total LCNITC,
    `Basic Price Per Unit`, `Landed Cost Per Unit ( INR )`.
- Cells can be empty for some bidders (one bidder charged IGST, the others CGST+SGST), so values
  must be read by column position, never by collapsing a row's text.
- Free-text answers are messy ("180 DAYS", "240", "N.A.").

Not yet seen: a statement with many items. Whether the grid lazy-loads rows or repeats the item
block per item is unknown and is the builder's first thing to check against a real multi-item RFx.

The capture files are in `~/.bmp-portal-capture/1400000013/` (`frame-1.html`, `page.png`).

## Goals

1. After a tender is marked Won or Lost, the app opens that tender's comparative statement in the
   portal browser window, reads it, and stores it. The user only acts if the portal asks for login.
2. Stored separately from our own BOQ/RFQ data: competitors, and every competitor's rate for every
   item, per tender.
3. A new left-menu page, Competitors:
   - by competitor: their items, and under each item the rate they quoted in each tender, with
     trend and predicted next rate;
   - by item: every competitor side by side in columns (plus "Us"), one row per tender, a
     predicted-next row at the bottom.
4. In the tender BOQ grid, under our Rate cell: the rate to beat for that item, red when our rate
   is above it, green when below, "no history" otherwise. Clicking opens a popup listing likely
   bidders with last rate, last tender, trend, predicted next rate, and our own row.
5. The lowest overall bidder of each tender is tracked and marked with a crown wherever that
   tender's rates are listed across vendors (the by-item table and the per-competitor rows).
6. Our own rate history and projected rate for an item sit in the same views as a competitor's.

## Non-goals

- Portals other than SAIL ISP.
- Reading the statement in the background or headlessly; it uses the same visible window as bid fill.
- Storing who was actually awarded the order. The statement only shows quotes; the crown means
  lowest overall quote, and is labelled that way.
- Merging competitors with the existing Vendor (supplier) records.
- Bulk back-fill of old tenders. A manual "Fetch comparative statement" action on a Won/Lost
  tender covers one-at-a-time catch-up.

## Anti-goals

- A wrong rate stored silently. If the page cannot be parsed with confidence (missing blocks,
  column count mismatch, RFQ no on the page differs from the tender), store nothing and say so.
- Marking a tender Won/Lost must never fail or hang because the portal is closed, logged out, or
  the statement is not published yet. The status change commits first; the fetch is a follow-up.
- A predicted rate presented as fact. It is always labelled predicted and absent when history is thin.
- The app never clicks Log On or types credentials.

## Decided with the owner

- Trigger: on marking Won/Lost, open the browser and fetch.
- Position of the rate to beat: under the Rate cell, with a popup; not a new last column.
- Competitors page in the left menu with both the by-competitor and by-item views (mockup:
  `.superpowers/brainstorm/90677-1794606978/content/competitor-rates.html`).
- Trend drives the predicted next rate per competitor and item.
- Crown for the lowest overall bidder.

## My calls (not confirmed by the owner; overrule freely)

- Competitor identity is the SAIL vendor code, unique per business. Name is updated to the latest seen.
- "Us" is the bidder whose quotation reference no equals `PortalBid.responseNumber` for that
  tender. That row is flagged, not stored as a competitor.
- Items are joined on the SAIL item code (`BoqItem.itemCode`, the same code bid fill uses). The
  statement's code, description, unit and quantity are stored on the rate row itself so history
  survives even when our BOQ has no matching line.
- Rates compared and predicted are basic price per unit. Landed cost per unit is stored too.
- Lowest overall bidder = lowest `Total LCNITC(As Quoted)` among bidders who quoted all items.
  Lowest per item (green in the mockup) is derived on read, not stored.
- Likely bidders for an item = competitors with at least one stored rate for that item code,
  most recent first. For a tender = the same, ranked by how many of its items they have quoted.
- Prediction: straight-line fit of basic rate over opening date for that competitor and item.
  Needs at least 2 tenders; with 1, show the last rate and "not enough history". Never predict
  below zero; clamp the step to the last observed change so one outlier cannot run away.
  Mark with a `ponytail:` comment: naive linear trend, revisit once real history exists.
- Rate to beat = lowest predicted (or, with thin history, last) rate among likely bidders.
- Re-fetching a tender replaces its stored statement in one transaction.
- The raw page HTML is kept as an attachment on the tender (`AttachmentsService`, its own
  `documentType`) so a parser fix can be re-run without the portal.
- Header-level answers other than vendor, quotation ref, MSE status, delivery days text and total
  are kept as one JSON blob per bidder, not columns.
- Permissions: `competitors:read` for the page and BOQ hints; fetching reuses `tenders:fill_portal`.
  Remember `pnpm db:seed` on every environment.

## Shape of the build

Follow the repo's module conventions (`CLAUDE.md`).

- **Data** (new tables, business-scoped): `Competitor` (vendor code, name), `ComparativeStatement`
  (one per tender: RFx no, fetched at, opening date, basis of evaluation, lowest overall bid),
  `ComparativeBid` (statement x bidder: competitor or is-us, quotation ref, total, delivery text,
  answers JSON), `ComparativeBidItem` (bid x item: item code, description, unit, quantity, basic
  rate, landed rate, optional `boqItemId`). Money is `Float`, like the rest of tenders.
- **Reading the page**: a pure parser from captured HTML to a typed statement, unit-tested against
  the saved `frame-1.html` as a fixture. A thin browser step in `PortalBrowser` opens the link in a
  tab, waits for the grid frame, and hands its HTML to the parser. If a login page comes up it
  reports "log in to the portal, then fetch again" instead of waiting forever.
- **Trigger**: after `changeStatus` commits WON/LOST, the web app calls the fetch endpoint and
  shows progress and outcome as a toast; the same call backs the manual action in the tender's
  More menu. Needs the server on a desktop, same limit as bid fill.
- **Reads**: competitors list, competitor detail (items with per-tender rates), item comparison
  (tenders x competitors), and a per-tender "rates to beat" read keyed by item code for the BOQ grid.
- **Web**: Competitors sidebar entry and page; hint line and popup in `boq-item-grid.tsx`;
  crown icon with an accessible label.
- **Clean-up**: remove the spike endpoint `POST /portal-bids/browser/capture-comparative/:rfxNumber`
  and `PortalBrowser.captureComparative` once the real fetch exists.

## Left to the builder

- How the tender's RFx number is obtained for the link (tender number, or store it on `PortalBid`
  at fill time) — check what a SAIL tender actually holds.
- Multi-item statements: scrolling/lazy rows in the ALV grid, and whether to use the Excel export instead.
- Exact trend maths within the rules above, chart or no chart on the by-item view.
- Parsing of free-text delivery days into a number (optional; text is always kept).

## Done means

- Parser test passes on the 1400000013 fixture: 5 bidders, 1 item, basic rates
  270.00 / 160.00 / 185.00 / 170.00 / 285.00, lowest overall Beta Engineering Corporation.
- Marking a tender Won or Lost with the portal window logged in stores its statement; with the
  portal closed or logged out, the status still changes and the user is told what to do.
- Competitors page shows both views; BOQ grid shows the rate to beat for items with history.
- Typecheck, lint and tests pass.
