# BMP — Phase 4 (Procurement) Implementation Plan

## Context

Phases 1–3 (Foundation, Tender Management, BOQ & Estimation) are complete and verified. Phase 4
covers the master spec's Procurement module (§10–11 area): vendor management, RFQ (Request for
Quotation) workflow, comparative statements, purchase orders, goods receipt, and vendor performance
tracking. Per `spec.md`: "Vendor management, RFQ workflow, comparative statements, purchase orders,
goods receipt, vendor performance tracking."

This builds additively on Phase 3: an RFQ's line items are typically drawn from a tender's current
BOQ items (reusing `boqItemId` references), and Purchase Orders reuse the generic `AttachmentsService`
for vendor quote documents/PO PDFs and `AuditService` for status history — same reuse discipline as
every prior phase.

## Scope decisions

- **Vendor is a new model, not a repurposed `Organization`.** `Organization` is specifically shaped
  for tender clients (`type: GOVERNMENT|PRIVATE`, no bank/GST-heavy payment fields). Vendors need
  category (material/service/subcontractor), GST/PAN, bank account details for payment, and a
  performance rating — different enough fields and lifecycle to warrant a dedicated `Vendor` +
  `VendorContact` pair, structurally mirroring `Organization`/`OrganizationContact`.
- **No vendor portal/login in this phase.** Vendors don't get user accounts. Purchase Managers
  record vendor quotes manually (received via email/phone/in person) against an RFQ — this matches
  the spec's "AI Coding Constraints" no-scope-creep rule and every other phase's operator-facing
  (not external-party-facing) design so far.
- **RFQ items can originate from a tender's current BOQ items or be entered manually.** An
  `RfqItem` optionally references a `boqItemId` (traceability, nullable) but always stores its own
  description/unit/quantity snapshot — RFQs must survive a BOQ item being edited/deleted later
  without breaking, same "snapshot, don't live-join" principle as `TenderCompetitor`.
- **Comparative statement is a computed read, not a new table.** Given all `RfqQuote` rows for an
  RFQ (vendor × item × rate), the comparison view is assembled in the service layer (lowest rate per
  item, total per vendor) — mirrors how tender status history is a filtered `AuditLog` read, not a
  dedicated table.
- **Purchase Order is created from an awarded RFQ (copies the winning vendor's quoted rates) or
  standalone (direct PO, no RFQ)** — both paths land in the same `PurchaseOrder`/`PurchaseOrderItem`
  shape; `sourceRfqId` is nullable.
- **Goods Receipt is partial-delivery-aware.** A `GoodsReceipt` (GRN) records a delivery event;
  `GoodsReceiptItem` rows increment `PurchaseOrderItem.receivedQuantity`. The PO's status
  (`ISSUED` → `PARTIALLY_RECEIVED` → `RECEIVED`) is derived server-side by comparing
  `receivedQuantity` to `quantity` across all items — never trust a client-sent status for this
  transition, same "recompute, don't trust client math" rule as BOQ amounts.
- **Vendor performance is a lightweight rating captured at PO closure**, not a scoring algorithm:
  `VendorRating` (one row per completed PO, 1–5 stars + remarks), with `Vendor.averageRating`
  computed on read (aggregate query), not stored/denormalized — avoids a recompute-on-every-write
  trigger for a rarely-read number.
- **`EditableTreeTable` (built in Phase 3) is reused for RFQ items and PO items** — both are flat
  (non-nested) line-item lists, which the component already supports (a flat tree is just depth-0
  rows), fulfilling the reuse intent stated when the component was built.

## Prisma schema additions

```prisma
enum VendorCategory {
  MATERIAL_SUPPLIER
  SERVICE_PROVIDER
  SUBCONTRACTOR
  EQUIPMENT_RENTAL
}

model Vendor {
  id             String         @id @default(uuid())
  name           String
  category       VendorCategory
  gstNumber      String?
  panNumber      String?
  address        String?
  city           String?
  state          String?
  bankAccountName   String?
  bankAccountNumber String?
  bankIfscCode      String?
  notes          String?
  isActive       Boolean        @default(true)

  createdById String
  createdBy   User   @relation("VendorCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  contacts       VendorContact[]
  rfqInvites     RfqVendor[]
  purchaseOrders PurchaseOrder[]
  ratings        VendorRating[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([name])
  @@map("vendors")
}

model VendorContact {
  id          String  @id @default(uuid())
  vendorId    String
  vendor      Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  name        String
  designation String?
  email       String?
  phone       String?
  isPrimary   Boolean @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([vendorId])
  @@map("vendor_contacts")
}

enum RfqStatus {
  DRAFT
  SENT
  CLOSED
  AWARDED
  CANCELLED
}

model Rfq {
  id       String    @id @default(uuid())
  tenderId String?
  tender   Tender?   @relation(fields: [tenderId], references: [id], onDelete: SetNull)
  title    String
  status   RfqStatus @default(DRAFT)
  dueDate  DateTime?

  createdById String
  createdBy   User   @relation("RfqCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  items          RfqItem[]
  vendorInvites  RfqVendor[]
  awardedVendorId String?
  purchaseOrders PurchaseOrder[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenderId])
  @@map("rfqs")
}

model RfqItem {
  id          String  @id @default(uuid())
  rfqId       String
  rfq         Rfq     @relation(fields: [rfqId], references: [id], onDelete: Cascade)
  boqItemId   String?
  description String
  unit        String?
  quantity    Float
  sortOrder   Int     @default(0)

  quotes RfqQuote[]

  @@index([rfqId])
  @@map("rfq_items")
}

enum RfqVendorStatus {
  INVITED
  RESPONDED
  DECLINED
}

model RfqVendor {
  id       String          @id @default(uuid())
  rfqId    String
  rfq      Rfq             @relation(fields: [rfqId], references: [id], onDelete: Cascade)
  vendorId String
  vendor   Vendor          @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  status   RfqVendorStatus @default(INVITED)

  createdAt DateTime @default(now())

  @@unique([rfqId, vendorId])
  @@index([vendorId])
  @@map("rfq_vendors")
}

model RfqQuote {
  id        String  @id @default(uuid())
  rfqItemId String
  rfqItem   RfqItem @relation(fields: [rfqItemId], references: [id], onDelete: Cascade)
  vendorId  String
  rate      Float
  remarks   String?

  updatedAt DateTime @updatedAt

  @@unique([rfqItemId, vendorId])
  @@map("rfq_quotes")
}

enum PurchaseOrderStatus {
  DRAFT
  ISSUED
  PARTIALLY_RECEIVED
  RECEIVED
  CANCELLED
}

model PurchaseOrder {
  id           String              @id @default(uuid())
  poNumber     String              @unique
  vendorId     String
  vendor       Vendor              @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  tenderId     String?
  tender       Tender?             @relation(fields: [tenderId], references: [id], onDelete: SetNull)
  sourceRfqId  String?
  sourceRfq    Rfq?                @relation(fields: [sourceRfqId], references: [id], onDelete: SetNull)
  status       PurchaseOrderStatus @default(DRAFT)
  expectedDeliveryDate DateTime?
  notes        String?

  createdById String
  createdBy   User   @relation("PurchaseOrderCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  items          PurchaseOrderItem[]
  goodsReceipts  GoodsReceipt[]
  vendorRating   VendorRating?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([vendorId])
  @@index([tenderId])
  @@map("purchase_orders")
}

model PurchaseOrderItem {
  id               String  @id @default(uuid())
  purchaseOrderId  String
  purchaseOrder    PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  description      String
  unit             String?
  quantity         Float
  rate             Float
  amount           Float
  receivedQuantity Float   @default(0)
  sortOrder        Int     @default(0)

  goodsReceiptItems GoodsReceiptItem[]

  @@index([purchaseOrderId])
  @@map("purchase_order_items")
}

model GoodsReceipt {
  id              String   @id @default(uuid())
  purchaseOrderId String
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  receivedDate    DateTime @default(now())
  remarks         String?

  receivedById String
  receivedBy   User   @relation("GoodsReceiptReceivedBy", fields: [receivedById], references: [id], onDelete: Restrict)

  items GoodsReceiptItem[]

  createdAt DateTime @default(now())

  @@index([purchaseOrderId])
  @@map("goods_receipts")
}

model GoodsReceiptItem {
  id                  String @id @default(uuid())
  goodsReceiptId      String
  goodsReceipt        GoodsReceipt @relation(fields: [goodsReceiptId], references: [id], onDelete: Cascade)
  purchaseOrderItemId String
  purchaseOrderItem   PurchaseOrderItem @relation(fields: [purchaseOrderItemId], references: [id], onDelete: Cascade)
  quantityReceived    Float
  remarks             String?

  @@index([goodsReceiptId])
  @@index([purchaseOrderItemId])
  @@map("goods_receipt_items")
}

model VendorRating {
  id              String  @id @default(uuid())
  vendorId        String
  vendor          Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  purchaseOrderId String  @unique
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
  rating          Int
  remarks         String?

  ratedById String
  ratedBy   User   @relation("VendorRatingRatedBy", fields: [ratedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([vendorId])
  @@map("vendor_ratings")
}
```

`Tender` gains `rfqs Rfq[]` and `purchaseOrders PurchaseOrder[]`. `User` gains `createdVendors
Vendor[]`, `createdRfqs Rfq[]`, `createdPurchaseOrders PurchaseOrder[]`, `receivedGoodsReceipts
GoodsReceipt[]`, `givenVendorRatings VendorRating[]`.

## Backend modules (`apps/server/src/modules/`)

- **`vendors/`** — CRUD + contacts sub-resource (exact mirror of `organizations/`), plus
  `GET /vendors/:id/performance` (average rating + rating history, computed via aggregate).
- **`rfq/`** — create (from tender's current BOQ items, a subset of item ids, or fully manual list)
  → invite vendors → record a vendor's quote per item (`PUT /rfq-items/:itemId/quotes/:vendorId`,
  upsert) → `GET /rfqs/:id/comparison` (computed comparative statement: per-item lowest rate +
  which vendor, per-vendor total) → `POST /rfqs/:id/award` (sets `awardedVendorId`, status
  `AWARDED`) → `POST /rfqs/:id/close` (status `CLOSED`, no more quotes accepted).
- **`purchase-orders/`** — create (`fromRfq: {rfqId}` copies awarded vendor's quoted items, or
  manual item list), CRUD, `PATCH /purchase-orders/:id/status` (DRAFT→ISSUED only manual
  transition; PARTIALLY_RECEIVED/RECEIVED are server-derived, never accepted from the client),
  goods-receipt sub-resource (`POST /purchase-orders/:id/goods-receipts` creates a GRN + increments
  `receivedQuantity` + recomputes PO status in one transaction, `GET .../goods-receipts` lists
  them), `PUT /purchase-orders/:id/vendor-rating` (only once PO status is RECEIVED).

Endpoints (permission column mirrors the `tenders:*`/`boq:*` pattern):

| Method & Path | Permission |
|---|---|
| GET/POST /vendors, GET/PATCH/DELETE /vendors/:id | `vendors:read` / `vendors:create` / `vendors:update` / `vendors:delete` |
| POST/PATCH/DELETE /vendors/:id/contacts | `vendors:update` |
| GET /vendors/:id/performance | `vendors:read` |
| GET/POST /rfqs, GET/PATCH /rfqs/:id | `rfq:read` / `rfq:create` / `rfq:update` |
| POST /rfqs/:id/vendors, DELETE /rfqs/:id/vendors/:vendorId | `rfq:update` |
| PUT /rfq-items/:itemId/quotes/:vendorId | `rfq:update` |
| GET /rfqs/:id/comparison | `rfq:read` |
| POST /rfqs/:id/award, POST /rfqs/:id/close | `rfq:update` |
| GET/POST /purchase-orders, GET/PATCH /purchase-orders/:id | `purchase_orders:read` / `:create` / `:update` |
| PATCH /purchase-orders/:id/status | `purchase_orders:update` |
| POST/GET /purchase-orders/:id/goods-receipts | `purchase_orders:receive` |
| PUT /purchase-orders/:id/vendor-rating | `purchase_orders:update` |

RBAC additions to `packages/types/src/rbac.ts`: `vendors:{create,read,update,delete}`,
`rfq:{create,read,update}`, `purchase_orders:{create,read,update,receive}`. Purchase Manager gets
full access to all three (this is their core job per the spec: "Manages vendors, issues RFQs,
creates purchase orders, tracks deliveries"); Tender Manager and Accounts get read-only (oversight/
payment-reconciliation visibility); Estimator/Project Manager read-only; Viewer read-only.

## Frontend

- `apps/web/src/app/(dashboard)/vendors/page.tsx` + `new`/`[id]`/`[id]/edit` — mirrors
  `organizations/*` pages exactly (DataTable, contacts managed inline via Dialog).
- `apps/web/src/app/(dashboard)/vendors/[id]/page.tsx` detail also shows a "Performance" tab
  (rating history list + average).
- `apps/web/src/app/(dashboard)/rfqs/page.tsx` (list) + `new/page.tsx` (create: pick a tender →
  pick BOQ items or add manual rows via `EditableTreeTable` in flat mode → invite vendors via
  `MultiSelect`) + `[id]/page.tsx` (detail: item list, invited vendors, a quote-entry grid — rows
  are items, columns are invited vendors, each cell an editable rate input — plus "View comparison"
  showing the computed comparative statement with the lowest rate per row highlighted, and
  "Award"/"Close" actions).
- `apps/web/src/app/(dashboard)/purchase-orders/page.tsx` (list) + `new/page.tsx` (create from an
  awarded RFQ, prefilled, or blank) + `[id]/page.tsx` (detail: item list via `EditableTreeTable`
  read-only view showing `quantity`/`receivedQuantity`/`rate`/`amount`, a "Record goods receipt"
  dialog with a per-item quantity-received input, goods-receipt history list, and a vendor-rating
  widget once RECEIVED).
- Nav additions: Vendors (`vendors:read`), RFQs (`rfq:read`), Purchase Orders
  (`purchase_orders:read`).

## Testing

Unit tests (fake repos): vendor CRUD + delete-blocked-when-referenced-by-a-PO; RFQ comparison math
(lowest rate per item, vendor totals, ties); PO status derivation from goods receipts (not received
→ partially → fully, across multiple GRNs); goods receipt rejects over-receiving beyond ordered
quantity. Integration test: create a vendor, create an RFQ from manual items, record quotes from two
vendors, award, create a PO from the award, post two partial goods receipts, confirm status reaches
RECEIVED and `receivedQuantity` sums correctly.

## Build order

1. Prisma schema additions + migration + RBAC matrix update
2. `vendors/` module (no dependencies, build first)
3. `rfq/` module (depends on vendors, optionally tenders/boq for item sourcing)
4. `purchase-orders/` module incl. goods-receipt sub-resource (depends on vendors, rfq)
5. Backend tests
6. Frontend: vendors pages → RFQ pages (incl. quote-entry grid + comparison view) → purchase order
   pages (incl. goods-receipt flow)
7. Typecheck, lint, build, test across the full monorepo
8. Run `pnpm db:migrate` + `pnpm db:seed`, browser walkthrough: create a vendor, create an RFQ
   against the tender used in Phase 3, add BOQ-sourced items, invite two vendors, record quotes for
   both, view the comparison, award, create a PO from the award, post a partial goods receipt then a
   final one, confirm PO status transitions, rate the vendor.

## Critical files (once built)

- `packages/database/prisma/schema.prisma`
- `apps/server/src/modules/rfq/rfq.service.ts` (comparison math, award/close transitions)
- `apps/server/src/modules/purchase-orders/purchase-orders.service.ts` (status derivation, goods
  receipt transaction)
- `packages/types/src/{vendor,rfq,purchase-order}.ts`, `packages/types/src/rbac.ts`

Phases 5–8 (Project Execution, Finance, Reporting, Production hardening) remain out of scope and
will each get their own plan once Phase 4 is verified working end-to-end.

## Status: shipped and verified

Built as planned. One real bug found and fixed during browser verification: the RFQ detail page's
invite/award `<Select>`s were seeded with a `"__none__"` sentinel value that had no matching
`SelectItem`, which made Radix Select render blank instead of the placeholder (Radix only shows the
placeholder when `value` is empty/undefined, not merely unmatched) — fixed by dropping the sentinel
on those two selects (unlike the tender-picker selects elsewhere, which do define a matching
`SelectItem value="__none__"` and were fine). Also fixed a real hydration bug: a `<Badge>` (renders a
`<div>`) was nested inside a `<p>` in the comparative-statement view — invalid HTML — changed the
wrapper to a `<div>`.

Verified: `pnpm turbo run lint typecheck build` clean across all 6 workspaces (web build/typecheck
must be run sequentially, not concurrently via turbo, since both write to `.next` — see gotchas);
86/86 backend tests passing (12 new PO unit tests covering status derivation across multiple goods
receipts and over-receiving rejection, 11 new RFQ unit tests covering comparison math/award/close
transitions, 5 new vendor unit tests, 6 new integration tests covering the full vendor→RFQ→quote→
award→PO→goods-receipt→rating lifecycle against a real Postgres). Browser walkthrough (Purchase
Manager role): created a vendor, created an RFQ with a manual item and invited the vendor, recorded a
quote, viewed the comparative statement, awarded the RFQ, created a PO from the award (rates copied
from the winning quote), issued it, recorded two partial goods receipts reaching RECEIVED, and rated
the vendor — confirmed via screenshots at every step.
