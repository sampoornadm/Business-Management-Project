# User Guide

A walkthrough of how to actually use the Business Management Platform (BMP) day to day — for
someone sitting down at the app, not someone deploying it. For environment/deployment topics see
[`deployment.md`](./deployment.md); for what each environment variable does see
[`environment-variables.md`](./environment-variables.md).

## Contents

1. [Logging in and the dashboard](#1-logging-in-and-the-dashboard)
2. [Roles — who can do what](#2-roles--who-can-do-what)
3. [Organizations (clients)](#3-organizations-clients)
4. [Tenders — the core workflow](#4-tenders--the-core-workflow)
5. [BOQ & Estimation](#5-boq--estimation)
6. [Vendors](#6-vendors)
7. [RFQs (procurement)](#7-rfqs-procurement)
8. [Purchase Orders & Goods Receipt](#8-purchase-orders--goods-receipt)
9. [Projects](#9-projects)
10. [Finance](#10-finance)
11. [Reports & Search](#11-reports--search)
12. [Notifications](#12-notifications)
13. [Your profile & sessions](#13-your-profile--sessions)
14. [Admin: users, roles, audit log](#14-admin-users-roles-audit-log)
15. [End-to-end example: one tender from creation to paid](#15-end-to-end-example-one-tender-from-creation-to-paid)

---

## 1. Logging in and the dashboard

Go to the app's URL — you'll land on `/login` if you're not authenticated. Sign in with your email
and password. Forgot your password? Use **Forgot password** on the login screen; you'll get a reset
link by email.

Once in, `/dashboard` shows:
- Total users, your role badge, and system health (database/cache/file storage status)
- Active tenders and pending-approvals counts, plus a chart of tenders by status
- Upcoming submission deadlines (next 7 days)
- Recent activity (audit log), if your role can see it

The left sidebar is your main navigation — every item is hidden or shown based on what your role is
allowed to touch, so don't worry about accidentally finding something you shouldn't use.

## 2. Roles — who can do what

| Role | What they own |
|---|---|
| **Super Admin** | Everything, including system configuration |
| **Admin** | Everything except system settings |
| **Tender Manager** | Creates tenders, uploads documents, assigns staff, drives the tender through its lifecycle |
| **Estimator** | Prepares BOQs, fills in rate analysis, builds estimates and comparisons |
| **Purchase Manager** | Manages vendors, issues RFQs, creates purchase orders, tracks deliveries |
| **Accounts** | Invoices, expenses, payments, GST, bank/cash books, financial reports |
| **Project Manager** | Tracks live projects: progress, material/labor usage, billing |
| **Viewer** | Read-only everywhere |

A page or button you don't have permission for simply won't appear — the same rule is enforced
again on the server, so there's no way to "guess" your way into something your role doesn't allow.

## 3. Organizations (clients)

**Organizations** are the clients who float tenders — government departments or private companies.
Create one (**Organizations → New**) before you can create a tender against it: name, type
(Government/Private), address, GST number, and any number of contacts. You can't delete an
organization that already has a tender against it.

## 4. Tenders — the core workflow

This is the heart of the application. Full detail in the sections below, but the short version:

1. **Create** (Tenders → New Tender): tender number, title, department, client, type, category,
   location, state, estimated cost, submission date, priority. Starts as `DRAFT`.
2. **Build it out**: upload documents (versioned — re-uploading the same document type keeps
   history), assign staff (they get notified), track competitors, add tags.
3. **Advance the status** one step at a time via the **Change status** button:

   ```
   DRAFT → UPCOMING → DOCUMENT_COLLECTION → UNDER_STUDY → BOQ_PREPARATION
     → RATE_ANALYSIS → APPROVAL_PENDING → SUBMITTED
     → TECHNICALLY_QUALIFIED → FINANCIALLY_QUALIFIED → WON or LOST → ARCHIVED
   ```

   You can only move to the next legal status — the button only offers valid options. `CANCELLED`
   is reachable from any pre-submission stage. Every change (who, when, remarks) is recorded and
   visible in the tender's **Status History** tab.
4. **Win or lose it**: moving to `WON` asks for the winner name and winning bid amount; moving to
   `LOST` asks for a reason. A `WON` tender can be **converted to a Project** (see §9); a `LOST` one
   just gets archived.

## 5. BOQ & Estimation

Open a tender's **BOQ** tab (typically once it's in `BOQ_PREPARATION`):

- **Upload** the Bill of Quantities as an Excel file or a PDF. For PDFs especially, extraction is
  best-effort — you'll be asked to confirm which columns map to description/unit/quantity/rate
  before it commits.
- The result is an editable, nested tree of line items (parent items with sub-items). Edit
  quantities and rates inline — the amount (quantity × rate) is always calculated by the server, so
  you can't accidentally save an inconsistent total.
- **Rate analysis**: for any item, break its rate down into material/labor/machinery/transport
  cost components, referencing historical rates from past tenders so estimates stay consistent.
- **Versions**: committing changes to an already-submitted BOQ creates a new version rather than
  overwriting — you can always see "all versions" of a BOQ and which one is current.
- **Compare**: view your BOQ side-by-side against another tender's BOQ to sanity-check estimates.

## 6. Vendors

**Vendors** are your suppliers/subcontractors. Add one (**Vendors → New**) with contacts and any
notes. As you do business with a vendor, their **rating** (from post-delivery reviews — see §8) and
**on-time delivery rate** accumulate automatically and show up in Vendor Performance reporting.

## 7. RFQs (procurement)

An RFQ (Request for Quotation) is how you shop for a price *before* committing to buy. You are the
buyer here — this is the reverse direction from a Tender, where you're the one being evaluated.

1. **RFQs → New**: optionally link it to a tender, pick which BOQ items you're sourcing, and set a
   due date.
2. **Invite vendors** — add as many as you want to compare.
3. Vendors submit a **quote** (rate) for each item. As quotes come in, the **comparative statement**
   updates automatically, showing every vendor's price per item side by side.
4. **Award** the RFQ to the vendor with the best offer (not necessarily the cheapest — that's your
   call), then **close** it. Awarding creates the basis for a Purchase Order.

## 8. Purchase Orders & Goods Receipt

- **Create a Purchase Order** either directly or straight from an awarded RFQ (which pre-fills the
  vendor and items).
- As deliveries arrive, record a **Goods Receipt** against the PO — partial deliveries are fine, you
  can receipt the same PO multiple times. The PO's status (`PARTIALLY_RECEIVED` / `RECEIVED`) is
  always computed from what's actually been receipted, never set by hand.
- After a delivery, **rate the vendor** — this feeds directly into the Vendor Performance report
  (average rating + on-time delivery %).

## 9. Projects

Once a tender is `WON`, its detail page shows a **Convert to Project** button (one project per
tender, and only once). From then on, work happens in the Project view:

- **Milestones**: add them with relative weights; overall project progress is the weighted sum of
  milestone completion.
- **Material usage** and **labor entries**: log consumption as work happens, at whatever cadence
  makes sense for the project.
- **Bills (progress/"RA" billing)**: raise a bill against the client; each bill's amount is the
  *delta* since the last bill's cumulative total — the server works this out for you so you never
  double-bill.
- **Costing/Progress dashboard**: a live comparison of the original BOQ estimate against actual
  purchase-order spend plus labor cost, against the budget — this is your real-time "are we on
  track" view.

## 10. Finance

Everything money-related lives under **Finance**:

- **Bank accounts**: set these up once; every payment gets attributed to one.
- **Invoices**: create one standalone, or — better — click **Create invoice** on a project's Bills
  tab to generate one straight from a progress bill (the amount is pre-filled from the bill).
- **Expenses**: log costs that aren't tied to a purchase order.
- **Payments**: record a payment against an invoice, an expense, or a purchase order payable. The
  status (`UNPAID → PARTIALLY_PAID → PAID`) is always recalculated from the sum of payments
  recorded — you never set "paid" directly, so the status can never drift from reality.
- The **Finance dashboard** shows total receivables, payables, cash balance, each bank account's
  running balance, and full cash/bank books (a chronological ledger of every movement).

## 11. Reports & Search

**Reports** (top nav) gives you five report tabs plus a KPI strip:

- **Tender Pipeline** — count by status, win rate, average time-to-submission
- **Procurement Spend** — total spend by vendor and by month (date-range filterable)
- **Project Costing** — budget vs. actual cost, per active project
- **Financial Summary** — received vs. paid by month (date-range filterable)
- **Vendor Performance** — average rating and on-time delivery rate per vendor
- **KPIs**: win rate, average BOQ turnaround time, average goods-receipt lead time, receivables DSO
  (days sales outstanding)

Every report has **Export to Excel** and **Export to PDF** buttons if you need to share or archive
a snapshot.

**Search** — the box in the topbar (or the dedicated `/search` page) finds tenders, organizations,
vendors, and projects by name/number as you type; press Enter or click **View all results** for the
full results page.

## 12. Notifications

The bell icon in the topbar shows your latest 10 notifications with an unread badge — you get one
whenever you're assigned to a tender, a tender's status changes, or (via a daily scheduled check)
when a tender's submission deadline is coming up in the next 1/3/7 days. Click **View all** for full
history at `/notifications`.

## 13. Your profile & sessions

**Profile** (top-right avatar menu): update your name, upload an avatar, change your password.
**Sessions**: see every device/browser you're currently logged in on, and revoke any you don't
recognize.

## 14. Admin: users, roles, audit log

(Admin/Super Admin only.)

- **Users**: create accounts (they get an email invite to set their own password), assign roles,
  deactivate accounts that leave.
- **Roles & Permissions**: view what each role can do — this mirrors the same permission matrix the
  server enforces, so it's an accurate reference, not just a display.
- **Audit Log**: a full, filterable history of who did what and when, across every module — this is
  the same underlying log that powers each tender's Status History tab, just unfiltered and
  system-wide.

## 15. End-to-end example: one tender from creation to paid

A concrete run-through tying every section above together:

1. **Tender Manager** creates Organization "State PWD", then creates tender `TND-2026-014` against
   it, status `DRAFT`.
2. Uploads the tender notice PDF, assigns **Estimator** Ethan, moves status to `UPCOMING` then
   `DOCUMENT_COLLECTION` then `UNDER_STUDY`, gathering the client's documents along the way.
3. Moves to `BOQ_PREPARATION`. **Estimator** uploads the BOQ Excel, fixes up a few line items, fills
   in rate analysis for the major cost items.
4. Moves to `RATE_ANALYSIS` → `APPROVAL_PENDING` → `SUBMITTED` once the bid is finalized and filed
   with the client.
5. Weeks later: client marks them `TECHNICALLY_QUALIFIED`, then `FINANCIALLY_QUALIFIED`, then the
   Tender Manager records the outcome as `WON` — winner name "Us", winning bid amount entered.
6. Tender Manager clicks **Convert to Project**. **Project Manager** takes over: adds milestones
   (Foundation 20%, Structure 40%, Finishing 40%).
7. Meanwhile, **Purchase Manager** raises an RFQ for steel against the tender's BOQ, invites three
   vendors, reviews the comparative statement, awards it to the cheapest qualified vendor, creates
   the PO, and later records the Goods Receipt when the steel arrives — then rates the vendor 4/5
   for on-time delivery.
8. **Project Manager** logs labor entries and material usage weekly as work proceeds, watching the
   Costing dashboard to confirm actual spend is tracking the BOQ estimate.
9. At 30% completion, **Project Manager** raises the first progress bill. **Accounts** clicks
   **Create invoice** on that bill, sends it to the client, and later records a payment against it
   as money comes in — its status flips from `UNPAID` to `PARTIALLY_PAID` to `PAID` automatically as
   payments land.
10. Anyone can check **Reports → Project Costing** at any point to see budget-vs-actual for this
    project, or **Reports → Tender Pipeline** to see it counted in the company's overall win rate.
