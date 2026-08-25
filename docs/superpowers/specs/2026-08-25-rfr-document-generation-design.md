# RFR Document Generation — Word/Excel/PDF (Design)

**Date:** 2026-08-25
**Status:** Approved, not yet implemented

## Context

This is the deferred **Piece 5** ("PDF/Word output... Independent of the data model") from
[2026-07-17-vendor-quote-capture-design.md](2026-07-17-vendor-quote-capture-design.md), now being
picked up as its own spec.

The trader's real workflow: get an item list to be supplied against a tender, generate a
Request-for-Rates (RFR) document listing those items (with any specific instructions) to forward
to vendors, later receive back a filled document with rates, and record those rates against the
RFQ. The RFQ module (`apps/server/src/modules/rfq/`) already models everything except the
document itself:

| Capability | Where |
|---|---|
| RFQ with items (from BOQ or manual), optional tender link | `Rfq`, `RfqItem` |
| Vendor invites, quote recording, comparison, award | `rfq.service.ts` |
| Excel round-trip: blank sheet out, filled sheet back in | `quote-sheet.ts` (`buildQuoteSheet`/`parseQuoteSheet`), `GET/POST /rfqs/:id/quote-sheet`, `/quotes/import` |
| Single-vendor plain-text email send | `rfq-document.ts#buildRfqText`, `quickSend` |

What's missing, and what this spec covers: a **Word and PDF** rendering of the same item list
(Excel's rendering already exists but has no letterhead/instructions block), and a place to
record **instructions** — both RFQ-level (e.g. delivery/payment terms) and per-item (e.g. "ISI
marked only") — since nothing today carries free text from us to the vendor beyond the item
description itself.

## Goals

- One shared set of content — business header, RFQ title/tender ref/due date, RFQ-level
  instructions, item rows (description/unit/qty/per-item instructions) plus blank
  Rate/Make/Model/Regret/Remarks columns — rendered three ways: `.docx`, `.xlsx`, `.pdf`.
- Works with zero per-business setup: no template file to place before it works.
- `Rfq.instructions` and `RfqItem.instructions` captured at create/update time.
- Three download actions on the RFQ detail page, alongside the existing quote-sheet action.

## Non-goals (deferred to later pieces)

- **Bulk/multi-vendor send with attachment.** This spec only builds the files; wiring them into
  `quickSend`/email as attachments, or a "send to N vendors" flow, is separate follow-on work.
  Vendor-selection/routing logic is explicitly out of scope per the requester.
- **Word/PDF absorption.** Rate capture continues to work exactly as it does today — the Excel
  round-trip (hidden `rfqItemId` column, `parseQuoteSheet`/`importQuotes`) is untouched and
  remains the one structured intake path, even after Word/PDF exist as send-out formats.
- **Per-business branded letterhead/logo for the Word document.** See [Decision:
  letterhead](#decision-letterhead) below — deferred, not forgotten.
- **Client PO tracking, PO-driven item-subset RFR generation.** Separate spec.

## Decision: letterhead

Considered following the existing Undertaking pattern exactly (`document-generation.service.ts`:
a per-business `.docx` template placed at `BUSINESSES_ROOT_DIR/<code>/templates/*.docx`, filled
via `docxtemplater`). Rejected for this document type: it would require per-business setup before
Word generation works at all, and would make Word inconsistent with Excel/PDF (which have no
comparable per-business template mechanism today).

**Chosen instead:** all three formats render a plain text header (business name, address, GST —
from the existing `Business` model, no logo) built from the same data in code. Word uses **one
generic template bundled in the repo** (`apps/server/templates/rfr.docx`, not per-business),
filled via the already-installed `docxtemplater` + `pizzip`. This works immediately for every
business and keeps all three formats visually consistent. A real branded per-business letterhead
can be layered on later using the exact Undertaking mechanism, without changing this design —
it would just mean swapping the bundled template lookup for the per-business one.

## Design

### Data model

Two nullable columns, additive, no backfill needed:

```prisma
model Rfq {
  // ...existing fields
  instructions String?   // NEW — shown once, above the item table
}

model RfqItem {
  // ...existing fields
  instructions String?   // NEW — per-line, distinct from RfqQuote.remarks (the vendor's reply)
}
```

Named `instructions` specifically to avoid confusion with `RfqQuote.remarks`, which already
exists and means the opposite direction (vendor's comment back to us).

### Shared renderer input

One plain-object shape, `RfrDocumentData`, built once in `rfq.service.ts` from an existing
`RfqDetail` + the business record, passed to all three renderers:

```ts
interface RfrDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  rfqTitle: string;
  tenderNumber: string | null;
  dueDate: string | null;      // pre-formatted, DD-MM-YYYY
  instructions: string | null;
  items: Array<{
    rfqItemId: string;
    description: string;
    unit: string | null;
    quantity: number;
    instructions: string | null;
  }>;
}
```

### Renderers

- **Excel** — extend `quote-sheet.ts#buildQuoteSheet` in place: add header rows (business block,
  RFQ title, tender ref, due date, instructions text) above the existing item table, and an
  "Instructions" column into the per-item block. The hidden `rfqItemId` column and everything
  `parseQuoteSheet` reads stays byte-for-byte the same — this is a purely additive change to rows
  above/columns beside what absorption already depends on.
- **PDF** — new `buildRfrPdf(data: RfrDocumentData): Promise<Buffer>` in `rfq-document.ts`, using
  `pdfkit` (already a dependency, already used this way in `reports.export.ts#exportTableToPdf`):
  header text block, then a paginated table with the same columns as Excel's blank-for-vendor
  section (Description/Unit/Qty/Instructions, plus blank Rate/Make/Model/Regret/Remarks for
  print-and-fill use, though PDF is not a re-import format).
- **Word** — new `buildRfrDocx(data: RfrDocumentData): Promise<Buffer>` in `rfq-document.ts`,
  using `docxtemplater` + `pizzip` against `apps/server/templates/rfr.docx`: a checked-in template
  with a `{{#items}}` loop row in a table, following the same `fillDocxTemplate` mechanism
  `document-generation.service.ts` already has (reused directly, not reimplemented).

### API

| Route | Permission | Notes |
|---|---|---|
| `GET /rfqs/:id/quote-sheet` (existing) | `rfq:read` | content enriched with header/instructions; URL and column layout for absorption unchanged |
| `GET /rfqs/:id/documents/pdf` (new) | `rfq:read` | same auth pattern as quote-sheet |
| `GET /rfqs/:id/documents/word` (new) | `rfq:read` | same auth pattern as quote-sheet |
| `POST /rfqs` (existing) | `rfq:create` | items gain optional `instructions`, same as today's `description`/`unit`/`quantity` |
| `PATCH /rfqs/:id` (existing) | `rfq:update` | `UpdateRfqData` gains `instructions` (RFQ-level only) |

No new RBAC keys — `rfq:read`/`rfq:create`/`rfq:update` already cover this.

**Item-level `instructions` is create-time only.** `RfqItem` rows have no update path today —
there's no `PATCH` for individual items, and this spec doesn't add one. Per-item instructions
are set when the item is added to the RFQ (`rfqs/new`), exactly like `description`/`unit`/
`quantity` already are, and are fixed thereafter along with those fields.

### Frontend

- `rfqs/new`'s item entry grid: an "Instructions" text field at the RFQ level (editable later via
  the same edit action that already handles title/due date), and an optional per-item
  instructions field alongside each item row, set at creation time only (see above).
- `QuoteSheetActions` (already rendered on the RFQ detail page): two more buttons, "Download Word"
  and "Download PDF", same blob-download mutation pattern the existing Excel button uses.

### Error handling

No new failure modes. The Word template is bundled in the repo (not per-business), so unlike the
Undertaking flow there's no "template missing" case to handle. The existing `NotFoundError` on a
missing RFQ (`getDetailOrThrow`) covers all three format endpoints identically.

### Testing

- Unit (`rfq-document.spec.ts` or similar): `buildRfrPdf`/`buildRfrDocx` produce a non-empty
  buffer; extracted text (via `pdf-parse` for PDF, and reading the filled `.docx`'s document.xml
  for Word) contains the RFQ title, instructions text, and every item description — mirroring how
  `quote-sheet.spec.ts` already verifies `buildQuoteSheet`/`parseQuoteSheet`.
- No changes to `parseQuoteSheet`/`importQuotes` behavior, so no new absorption tests required.
- No frontend test for the two new download buttons — manual verification, consistent with this
  codebase's practice for simple binary-download actions (see the Undertaking spec's same call).

## Scope boundaries

**In:** `Rfq.instructions`/`RfqItem.instructions` columns, the three renderers (Excel enriched
in place, PDF and Word new), the two new download routes, the two new frontend buttons and the
instructions input fields.

**Out, by decision:**

| Deferred | Why |
|---|---|
| Bulk multi-vendor send with attachments | Vendor-routing logic explicitly stashed by the requester; separate spec |
| Word/PDF-based rate absorption | Excel round-trip already works and stays the one intake format |
| Per-business branded Word letterhead | Would require per-business setup; plain-text header ships first, see [Decision](#decision-letterhead) |
| Client PO tracking + item-subset RFR generation | Independent new subsystem, separate spec |

## Related

- `2026-07-17-vendor-quote-capture-design.md` — Excel round-trip this spec extends, and the
  original "Piece 5" deferral this spec fulfills
- `2026-07-13-document-generation-design.md` — the `docxtemplater`/`pizzip` mechanism and
  `fillDocxTemplate` helper this spec reuses for the Word renderer
- `CLAUDE.md` — module conventions
