# Bill Generation (Tender-Scoped, v1 — No GST) — Design

**Date:** 2026-08-27
**Status:** Implemented

## Context

The trader needs to bill a client (e.g., IISCO) for goods supplied against a won tender,
referencing the client's own GRN (goods receipt note) as proof of delivery, with the trader's
signature stamped on it, producing a PDF that gets shared to the client. A "Bills" section
should list every bill raised, across every tender.

This reuses two patterns already proven in this codebase: the per-business template-file
convention (Undertaking's `.docx` template — here, a signature `.png` instead) and the
pdfkit-based document renderer built for RFR generation (business header, item table, one
shared data shape).

An earlier detour considered integrating a third-party open-source GST invoice generator;
rejected — every candidate found is a standalone app with its own storage, not a library, so
"integrating" one would mean running a second disconnected app rather than reusing anything.
Building on this app's own already-proven document-generation pattern is less work, not more.

## Goals

- New `Bill`/`BillItem` models, scoped to a **won** Tender (same status gate `ConvertToProject`
  already uses) — does not require converting the tender to a Project first.
- Line items are picked from the tender's BOQ (reusing `description`/`unit`/`rate` already
  there), with a per-line **quantity being billed now** — usually less than the BOQ's full
  quantity, since one GRN often covers partial delivery.
- GRN reference: `grnNumber`/`grnDate`, typed fields, printed on the bill ("Against GRN No. X
  dated Y") — a reference only, not the GRN file itself.
- PDF: business header (name/address/GST), client (`Tender.client` Organization) name/address,
  bill number, bill date, tender reference, the GRN reference line, an item table
  (Description/Unit/Qty/Rate/Amount), a Total, and the business's signature image stamped near
  the bottom.
- Signature file: one per business, fixed path, same convention and same "not found, place it
  at X" error as the existing Undertaking template.
- Frontend: a "Create Bill" action on the Tender detail page (shown only when the tender is
  WON, mirroring `ConvertToProjectDialog`'s exact gate), a Bill creation page, a Bills list page
  (new sidebar entry, every bill across every tender), and a Bill detail page with a Download
  PDF button using the same real-filename-from-`Content-Disposition` pattern just built for RFR.

## Non-goals (deferred, tracked separately)

- **GST math** — no CGST/SGST/IGST split, no GSTIN line, no HSN codes. Explicitly deferred by
  the requester (memory: `project_gst_compliant_billing_open_item.md`) — a correct split needs
  client/business state fields this schema doesn't track yet, and a flat approximate number
  would look official without being compliant. Bill v1's item table has no GST column at all.
- **Merging the GRN PDF into the bill document** — reference only (see Goals above), not
  attached/appended. The client's GRN can still be filed as a generic Tender attachment
  separately, same as any other received document.
- **USB-token / DSC cryptographic signing** — the requester already owns a physical DSC token
  and wants this eventually, but it's a genuinely separate, harder integration (PKCS#11/driver-
  level work, not a document-rendering concern) — a follow-on spec, not part of this one.
- **Editing or voiding a bill after creation** — v1 is create-and-download only, no update/delete
  endpoint. If a bill is wrong, the workflow is to make a new one; nothing here prevents that.
- **No status field.** A Bill is a real generated document the moment it's created — no
  DRAFT/ISSUED workflow. `ProjectBill`'s existing `BillStatus` enum (DRAFT/SUBMITTED/APPROVED/
  PAID) models a different, heavier approval-and-payment workflow this feature doesn't have;
  reusing it here would misrepresent what this Bill actually tracks.
- **Emailing the bill.** Download-and-share-yourself for v1; the existing email-queue
  infrastructure could carry this later without any change to the document itself.

## Design

### Data model

```prisma
model Bill {
  id          String    @id @default(uuid())
  businessId  String
  business    Business  @relation(fields: [businessId], references: [id], onDelete: Restrict)
  tenderId    String
  tender      Tender    @relation(fields: [tenderId], references: [id], onDelete: Restrict)
  billNumber  String    @unique
  billDate    DateTime  @default(now())
  grnNumber   String?
  grnDate     DateTime?
  notes       String?

  items BillItem[]

  createdById String
  createdBy   User   @relation("BillCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([businessId])
  @@index([tenderId])
  @@map("bills")
}

model BillItem {
  id          String  @id @default(uuid())
  billId      String
  bill        Bill    @relation(fields: [billId], references: [id], onDelete: Cascade)
  // Unenforced reference to the BOQ line this was picked from — same convention as
  // RfqItem.boqItemId (no FK; BoqItem already has no relation to lines it seeds elsewhere).
  boqItemId   String?
  description String
  unit        String?
  quantity    Float
  rate        Float
  sortOrder   Int     @default(0)

  @@index([billId])
  @@map("bill_items")
}
```

Per-line `amount` and the bill's subtotal/total are **computed on read** (`quantity × rate`,
summed) — never stored. Same "recompute, don't trust a stored copy" rule this app already
applies to BOQ amounts and PO receiving status.

`billNumber` is generated the same way `PurchaseOrder.poNumber` already is:
`` `BILL-${randomUUID().split("-")[0]!.toUpperCase()}` `` — no sequential counter, no locking
concern, matches an established pattern exactly.

### Backend module — `apps/server/src/modules/bills/`

Standard layout: `bills.repository.ts`, `bills.service.ts`, `bills.controller.ts`,
`bills.routes.ts`, `bills.validation.ts`, `bills.mapper.ts`, `bills.module.ts`, plus
`bill-document.ts` (the pdfkit renderer, sibling in spirit to `rfq-document.ts`).

- `createBill(tenderId, grnNumber?, grnDate?, items[])`: loads the tender, throws
  `ConflictError("Only a tender with status WON can be billed")` if not WON (same message shape
  as the Convert-to-Project guard), generates `billNumber`, persists `Bill` + `BillItem` rows in
  one transaction.
- `listBills` (paginated, across every tender for the business — same shape as
  `rfq.service.ts#listRfqs`), `getById`.
- `buildBillPdfFor(billId, businessId)`: loads the bill with its items, tender, client
  (`Tender.client` Organization), and business; shapes them into a `BillDocumentData` (mirrors
  `RfrDocumentData`'s role: one plain object, one renderer); calls `buildBillPdf(data)` in
  `bill-document.ts` (pdfkit — same dependency, same event-driven buffer-collection pattern as
  `buildRfrPdf`); stamps the signature via `doc.image(signatureBuffer, x, y, { width })` near the
  bottom of the page.
- Signature file lookup **reuses** `document-generation.service.ts`'s existing
  `getTemplatePath`/`getTemplateStatus` machinery rather than forking a parallel path resolver:
  widen `DocumentType` from `"undertaking"` to `"undertaking" | "signature"`, and add
  `signature: "signature.png"` to `TEMPLATE_FILENAMES`. The file lives at the same place a
  business already keeps its Undertaking template:
  `~/BMP-Businesses/<code>/templates/signature.png`. Missing file → the same
  `NotFoundError` shape Undertaking generation already throws ("... not found. Place it at ...").

### API

| Route | Permission | Notes |
|---|---|---|
| `POST /bills` | `bills:create` | body: `tenderId`, `grnNumber?`, `grnDate?`, `items[]` |
| `GET /bills` | `bills:read` | paginated, across every tender |
| `GET /bills/:id` | `bills:read` | detail |
| `GET /bills/:id/pdf` | `bills:read` | pdf download |

Two new RBAC permission keys, added to `ROLE_PERMISSION_MATRIX` in `packages/types/src/rbac.ts`.
`ACCOUNTS`'s own role description already reads "Manages bills, payments, invoices, taxes, GST,
and financial reports" — this is squarely its job. `bills:create` → `ADMIN` (via
`ALL_STANDARD_PERMISSIONS`), `ACCOUNTS`, `TENDER_MANAGER`; `bills:read` → the same three plus
`VIEWER` (read-only visibility for everyone else already able to see tenders). `SUPER_ADMIN`
needs no explicit entry — the seed script (`packages/database/prisma/seed.ts:128`) grants it a
wildcard permission instead of enumerating the matrix, so any new key added there is covered
automatically.

### Frontend

- New sidebar entry **Bills** → `/bills`: paginated list (TanStack Table, same shape as
  `/rfqs`/`/items`) — Bill#, Tender, Client, Date, Total, with a Download action per row.
- Tender detail page: a **Create Bill** button next to `ConvertToProjectDialog`, shown only when
  `tender.status === "WON"` — links to `/bills/new?tenderId=<id>`.
- `/bills/new`: tender preselected from the query param; a BOQ item picker (reuses the
  checkbox-table + `flattenBoqItems` pattern already in `rfqs/new/page.tsx`) where each selected
  item's billed quantity defaults to the BOQ's full quantity and is editable down; GRN
  number/date fields; submit creates the bill and redirects to `/bills/[id]`.
- `/bills/[id]`: line items, computed total, GRN reference, and a Download PDF button using the
  exact blob-download-with-real-filename helper already built for the RFR downloads
  (`filenameFromContentDisposition` in `quote-sheet-actions.tsx` — reused, not reimplemented; the
  CORS `exposedHeaders` change already covers this new endpoint too, no further config needed).

### Testing

- Unit (`bills.service.spec.ts`, hand-written fake repository): the WON-status gate rejects a
  non-WON tender; `billNumber` generation; total computation from line items (including a
  partial-quantity line to prove it's not silently using the BOQ's full quantity).
- Unit (`bill-document.spec.ts`): `buildBillPdf` produces a structurally valid PDF (`%PDF`
  header, `%%EOF` trailer, length floor) — same approach as `buildRfrPdf`'s test, for the same
  reason (pdf-parse cannot parse pdfkit output, established ruling, not re-litigated here).
- Integration: create a bill against a WON tender → download its PDF → 200, correct
  content-type, non-empty body.
- No frontend test, consistent with this codebase's practice for simple CRUD pages and file
  downloads.

## Scope boundaries

**In:** `Bill`/`BillItem` models + migration, the `bills` module (create/list/get/pdf — no
update/delete), the pdfkit renderer with signature stamping, GRN reference fields, the three new
frontend pages, the Tender page's Create Bill action, two new RBAC keys.

**Out, by decision:**

| Deferred | Why |
|---|---|
| GST split, GSTIN, HSN codes | Needs client/business state data this schema doesn't track; tracked in `project_gst_compliant_billing_open_item.md` |
| GRN PDF merged into the bill | Reference only, per explicit choice during brainstorming |
| USB-token/DSC cryptographic signing | Separate, harder integration; own future spec |
| Bill editing/voiding, email delivery | Not asked for; existing infra (email queue) could carry delivery later with no change to the document itself |

## Related

- `2026-07-13-document-generation-design.md` — the per-business template-file convention and
  `fillDocxTemplate`/`getTemplatePath` machinery the signature lookup extends.
- `2026-08-25-rfr-document-generation-design.md` — the pdfkit renderer pattern and the
  Content-Disposition-based download-filename mechanism, both reused directly.
- `project_gst_compliant_billing_open_item.md`, `project_admin_rate_override_open_item.md` —
  related open items from the same session.
