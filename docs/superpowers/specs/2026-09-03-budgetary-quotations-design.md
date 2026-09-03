# Budgetary Quotations + Quotation Documents — Design

Date: 2026-09-03

## Problem

Some clients ask for a rough, budgetary price quote before there's a real tender: no fixed
submission timeline, and the estimator typically pads the rates a bit since the client may
negotiate a discount later. These go through the same BOQ/pricing pipeline as a real tender, but
they aren't tenders — they shouldn't show up in the tender pipeline, they need their own
identifier, and when a client's budgetary enquiry later turns into a real tender, the estimator
wants to tag the real tender back to the earlier budgetary quotation so both price lists are easy
to find together.

Separately, there's currently no way to export a tender's (or budgetary quotation's) finalized
BOQ as a client-facing "Quotation" document. The only existing document generation is the
Undertaking (`apps/server/src/modules/document-generation/`), a single `.docx` template fill.

Explicitly out of scope for this design (deferred by the user): filling online tender-submission
portal forms from tender data.

## Current state (relevant facts, verified in code)

- `Tender.tenderNumber` is a required, user-typed, unique string (`tenders.validation.ts`:
  `tenderNumber: z.string().min(1).max(100)`) — there is no auto-numbering sequence for tenders
  today. Real tender numbers come from the government notice; the user copies them in.
- Purchase Orders and Bills *are* auto-numbered, entirely server-side, with no user input:
  `` `PO-${randomUUID().split("-")[0].toUpperCase()}` `` (`purchase-orders.repository.ts:97`) and
  the same pattern for `BILL-...` (`bills.repository.ts:64`). No sequence table, no counter —
  just a random short id per prefix.
- `document-generation.service.ts` supports exactly two `DocumentType`s: `"undertaking"` (a
  `.docx` template filled via Docxtemplater) and `"signature"` (a static image). Both are looked
  up per-business at `<BUSINESSES_ROOT_DIR>/<businessCode>/templates/<file>`.
  `generateUndertaking()` fetches the tender, fills the template, and returns a buffer + filename
  — the controller streams it to the browser. It does **not** currently also save a copy into the
  tender's folder.
- Tender documents are organized into fixed subfolders per `TENDER_DOCUMENT_TYPES`
  (`packages/types/src/tender.ts`) via `TENDER_DOCUMENT_TYPE_FOLDER_NAMES`, and
  `ensureTenderFolders()` creates that subfolder tree under
  `<BUSINESSES_ROOT_DIR>/<businessCode>/tenders/<tenderNumber> - <title>/` at tender-creation
  time, keyed only off `tenderNumber`/`title` — nothing here needs to change to support a second
  numbering scheme.
- RFQ already generates three downloadable documents, each its own endpoint
  (`rfq.routes.ts`): a quote sheet (`.xlsx`, `quote-sheet.ts`), an RFR PDF (`pdfkit`,
  `rfq-document.ts`), and an RFR Word doc (Docxtemplater, same `fillDocxTemplate` helper). The web
  page (`components/rfq/quote-sheet-actions.tsx`) currently renders these as three separate
  "Download ..." buttons.
- The tender detail page (`app/(dashboard)/tenders/[id]/page.tsx`) has one standalone "Generate
  Undertaking" button. The tenders list (`components/tenders/tender-table-columns.tsx`) has no
  row-actions column at all today.
- BOQ versioning already exists and is exactly the "revise this quotation" mechanism needed:
  `Boq`/`BoqItem` use a `groupId` self-reference + `version`/`isCurrent`, and `BoqItemGrid`
  reads/writes whichever version `isCurrent`. Re-pricing a budgetary quotation is just committing
  a new BOQ version under the same `Tender` row — no new versioning concept needed.
- `tenders:generate_document` is the existing permission gating Undertaking generation
  (`requirePermission("tenders:generate_document")` in `document-generation.routes.ts`) — broad
  enough to cover Quotation generation too.

## Data model changes

`packages/database/prisma/schema.prisma`:

```prisma
enum TenderKind {
  TENDER
  BUDGETARY
}

model Tender {
  ...
  kind            TenderKind @default(TENDER)
  convertedFromId String?
  convertedFrom   Tender?    @relation("BudgetaryConversion", fields: [convertedFromId], references: [id], onDelete: SetNull)
  convertedTo     Tender[]   @relation("BudgetaryConversion")
  ...
  @@index([kind])
}
```

- `kind` distinguishes the two; every other field/relation (BOQ, RFQ, PurchaseOrder, Bill,
  Project, assignees, tags, status, etc.) is shared as-is — a budgetary quotation runs through the
  identical BOQ/estimation pipeline, just tagged differently.
- `convertedFromId` lives on the **TENDER**-kind row and points at the **BUDGETARY**-kind row it's
  linked to. One tender links to at most one budgetary quotation (confirmed with the user — no
  join table needed). A budgetary quotation can be revised any number of times via ordinary BOQ
  versioning before/after that link is made; the link itself doesn't version.
- No changes needed to `submissionDate`/`openingDate` — already nullable, so "no fixed timeline"
  costs nothing.

## Tender numbering

- `TENDER`-kind creation keeps today's behavior exactly: `tenderNumber` is required, user-typed,
  validated unique (existing `z.string().min(1).max(100)`).
- `BUDGETARY`-kind creation: `tenderNumber` is **not** collected from the user. The server
  generates it the same way PO/Bill numbers already are: `` `BQ-${randomUUID().split("-")[0]
  .toUpperCase()}` ``, retried on the (rare) unique-constraint collision the same way the
  PO/Bill repositories already handle it.
- `createTenderSchema` (`tenders.validation.ts`) changes from `tenderNumber: z.string().min(1)...`
  to optional, with the service layer enforcing "required when kind is TENDER, ignored/generated
  when kind is BUDGETARY" — a `superRefine` or a plain service-level check, matching how
  `optionalText`/`optionalNumber` already express conditional shape in this file.
- Folder creation (`ensureTenderFolders`) is unaffected — it already just consumes whatever
  `tenderNumber`/`title` end up on the row, so a `BQ-A1B2C3D4 - <title>/` folder is created the
  same way a `TND-.../` one is today.

## Linking UX

- No auto-generation of a tender from a budgetary quotation — the user creates the real tender
  the normal way (manual entry or document extraction) whenever it actually materializes.
- On a **TENDER**-kind tender's detail page, an editable "Linked budgetary quotation" field: a
  searchable picker scoped to `BUDGETARY`-kind tenders for the same `clientId`, writing
  `convertedFromId`. Clearing it sets the field back to `null`.
- Once linked, the tender detail page shows a small card for the linked budgetary quotation
  (number, title, last-updated) with its own "Download quotation" action pulling *that* budgetary
  quotation's current BOQ version — so assembling what goes to the client (old budgetary quote +
  new tender's quote) is two clicks from one page, without navigating away.
- This field/card only renders for `TENDER`-kind tenders; a budgetary quotation has no reciprocal
  UI beyond appearing in the picker (its `convertedTo` relation isn't surfaced anywhere — YAGNI,
  nothing asked for it).

## Quotation document generation

- New `DocumentType = "quotation"` in `document-generation.service.ts`, and a new
  `TENDER_DOCUMENT_TYPES` entry `QUOTATION` → folder name `"Quotations"` in
  `packages/types/src/tender.ts` (mirrors `UNDERTAKING` → `"Undertakings"` exactly).
- Shared data-prep step: given a tender id, load its **current** BOQ version's items flattened by
  `sortOrder` (same shape `BoqItemGrid`/`EditableTreeTable` already render) — `itemCode`,
  `description`, `unit`, `quantity`, `rate`, `amount` — plus a computed grand total. No markup/
  discount logic applied — it prints whatever's currently in the BOQ (per the user: rates are
  just typed higher when pricing a budgetary quotation, nothing automatic).
- Three renderers off that same row data, one per format, all in a new
  `quotation-document.ts` alongside the existing `document-generation.service.ts`:
  - **CSV**: plain rows, no library needed.
  - **PDF**: reuse the `exportTableToPdf` utility already in the codebase (used elsewhere for
    tabular exports) rather than hand-rolling another `pdfkit` table like RFQ's RFR PDF does.
  - **Word**: same `fillDocxTemplate` helper as Undertaking, against a new `quotation.docx`
    template with a Docxtemplater repeating-row loop, stored at
    `<business>/templates/quotation.docx` next to the existing `undertaking.docx`/`signature.png`.
- Unlike today's `generateUndertaking` (stream-only), Quotation generation **also** saves a copy
  into `<tender folder>/Quotations/` at generation time — closing the gap the user flagged
  ("simultaneously to the tenders folder path in a separate subfolder just like the other
  files"). Since this is a real behavioral improvement, apply the same "also save a copy" fix to
  `generateUndertaking` while touching this file, so both document types behave consistently.
- One route per format: `POST /tenders/:id/documents/quotation?format=docx|csv|pdf`, gated by the
  existing `tenders:generate_document` permission. Works identically for `TENDER`- and
  `BUDGETARY`-kind tenders — it's the same BOQ shape either way.

## UI

- **New Tender page**: a `Tender` / `Budgetary Quotation` toggle at the top of the form. When
  `Budgetary Quotation` is selected, the `Tender Number` field is hidden (server generates it);
  everything else in the form is unchanged.
- **Tenders list**: a `kind` filter (query param, mirrors the existing `status`/`priority`
  filters in `listTendersQuerySchema`), defaulting to `TENDER` so budgetary quotations stay out of
  the everyday pipeline view, with a tab/toggle to switch to Budgetary Quotations.
- **Tender detail page**: identical tabs/layout for both kinds — no tab-hiding logic, since the
  user explicitly wants the same pipeline available. A "Budgetary Quotation" badge replaces the
  status-badge styling cue when `kind === BUDGETARY` so it's visually obvious which one you're in.
  The linking picker/card from the previous section shows only when `kind === TENDER`.
- **Download menu, three places** — one shared `TenderDownloadMenu` component
  (`components/tenders/`), a `DropdownMenu` (already in `packages/ui`, submenu support already
  present — no new dependency) with items `Undertaking` and `Quotation ▸ {Word, CSV, PDF}`:
  - Tender detail page header — replaces the current standalone "Generate Undertaking" button.
  - Tenders list — a new row-actions column in `tender-table-columns.tsx` (none exists today),
    same dropdown per row, driven off `row.original.id`/`tenderNumber` already in
    `TenderListItemDto`.
- **RFQ page**: a second shared component, `RfqDownloadMenu`, replacing the three separate
  "Download quote sheet / Word / PDF" buttons in `quote-sheet-actions.tsx` with one dropdown
  (`Quote sheet`, `Word`, `PDF`) hitting the same three existing endpoints — no backend change on
  the RFQ side, no `Quotation` entry (an RFQ isn't priced yet; that's what it's requesting).

## Non-goals

- Automatic markup/discount percentage fields on budgetary quotations — the user prices them by
  typing a higher rate, same fields as a real tender.
- Any restriction on which tabs/actions (RFQ, PO, Bills, Project) are usable from a
  `BUDGETARY`-kind tender — left fully available; nothing requested restricting them.
- Online tender-submission form-filling from tender data — explicitly deferred by the user to a
  later piece of work.
- A `convertedTo` reverse-navigation UI on the budgetary quotation itself — not requested.

## Deferred

- **Client/business-scoped numbering scheme.** The random-suffix `BQ-A1B2C3D4` numbering above is
  intentionally the simplest thing that works for this pass. The user wants a real numbering
  system later — budgetary (and possibly tender) numbers derived from the client and the business
  currently in use (e.g. a per-client/per-business running sequence) — but that's out of scope
  here and needs its own design pass when picked up.
