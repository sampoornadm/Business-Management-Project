# Project hub driven by the client PO (supply-order flow)

## Context
After a tender is won, the client sends a PO confirming which items we supply (whole tender, only the L1 items, or anything else). Today nothing stores it: the "Purchase orders" tab is only our vendor POs, Tender keeps winner/amount/wonItems, and Project is a construction-style shell (budget, milestones, material, labor, running bills). The user wants the **Project** to be the hub: convert won tender → project, upload the client PO inside it (sanity-checked against our quoted rates), and let it drive procurement, receiving, dispatch (e-way bill + tech docs), GRN, billing, payment, and finally a true-profit report.

Decisions made: client PO lives **inside the project** (no separate tab); board tracks **shipments** after dispatch with per-item quantity progress before it; old Milestones/Material/Labor/running-Bills tabs **hidden** (data kept); build **Phase A first**. On execution, mirror this file to `.claude/plans/phase-9-project-hub.md`.

## Roadmap
- **Phase A — Project hub + client PO** (detailed below).
- **Phase B — Item pipeline**: link vendor PO lines to client PO lines; receiving via existing GoodsReceipt; shipments (`Consignment`: items+qty, e-way bill no./date/file, tech-doc attachments, sent date, GRN no./date/file) moving Dispatched → GRN → Billed → Paid on a board; bill generated from a shipment through the existing Bills module (already has grnNumber + IISCO document); payment via existing `Payment` (entityType BILL). Freight = `Expense` (TRANSPORT) with projectId.
- **Phase C — Profit reports**: per project and overall: Σ client payments received vs Σ vendor PO cost (received qty × rate) + project expenses (freight etc.); extend `reports.service.ts#getProjectCosting`.
- **Phase D — AI for GRN / e-way bill / vendor invoices**: same extraction pipeline, identify linked PO by number. E-way bill *generation* needs a GSP/NIC API account — record-only until then.
- Later: rejections, credit notes, PO amendments.

## Phase A design

**Data** (`packages/database/prisma/schema.prisma`; `pnpm db:migrate:create --name client_purchase_orders`, hand-check SQL, `pnpm db:generate`):
- `ClientPurchaseOrder`: id, businessId, projectId (FK Cascade), poNumber (`@@unique([businessId, poNumber])`), poDate, deliveryDueDate (required; prefill poDate + `tender.deliveryPeriodDays`), poValue (server-recomputed Σ items), notes?, createdById, timestamps. Several POs per project allowed.
- `ClientPurchaseOrderItem`: id, clientPurchaseOrderId (Cascade), boqItemId? (unenforced snapshot ref, same convention as `BillItem.boqItemId`), description, unit?, quantity, rate, amount, sortOrder.
- PO PDF via `AttachmentsService` (`entityType: "CLIENT_PURCHASE_ORDER"`) — no new upload code.
- Rate sanity check is **derived on read**, not stored: per item compare with the current BOQ line (`boqItemId`) → flags `RATE_MISMATCH` (≠ our quoted rate), `QTY_ABOVE_BOQ`, `UNIT_MISMATCH`, `NOT_IN_BOQ`; plus "BOQ lines not ordered".

**Backend** `apps/server/src/modules/client-purchase-orders/` mirroring `modules/purchase-orders/` (repository/service/controller/routes/validation/mapper/module). Routes nested under project: `POST/GET /projects/:projectId/client-purchase-orders`, `GET/PATCH/DELETE /client-purchase-orders/:id`, `POST /projects/:projectId/client-purchase-orders/extract` (upload PDF/docx/xlsx → draft fields, nothing saved).
- Extraction reuses the tender-extraction stack (`tenders/tender-extraction.service.ts`, `tender-extraction.parser.ts`, `shared/utils/pdf-text.ts`, `shared/utils/xlsx.ts`, Ollama client); LLM pulls PO no./date/delivery date; items matched to BOQ lines by item code/description using the deterministic matcher used for BOQ rows; Ollama down ⇒ `ServiceUnavailableError`, manual entry still works.
- Project creation requires tender WON (verify existing guard in `projects.service.ts`).
- `AuditService.log` on create/update/delete. RBAC: `client_purchase_orders:create|read|update|delete` in `packages/types/src/rbac.ts`, roles like `bills:*`; `pnpm db:seed` per env.
- Project overview endpoint (`GET /projects/:id/overview` or extend project DTO): tender summary, RFQs for the tender with vendor quote summary (reuse RFQ repository), distinct vendors, vendor POs by `tenderId` with received %, client POs, earliest open deliveryDueDate, progress = Σ received value / Σ client PO value (Phase B refines).

**Frontend** (`apps/web/src/app/(dashboard)/projects/[id]/page.tsx` + `components/projects/`):
- Header: `PageHeader` with a **deadline countdown** badge ("23 days left" / "5 days overdue", colour by urgency) from earliest due date, and a progress bar.
- Tabs: **Overview** (tender summary, vendors, RFQ responses, vendor POs) · **Client PO** (upload → review form prefilled by extraction, items in `EditableTreeTable`, sanity flags inline, save) · Documents. Hide Milestones/Material/Labor/Bills tabs (leave components/data in place).
- Hook `apps/web/src/hooks/use-client-purchase-orders.ts`; nav: rename "Purchase orders" → "Vendor POs" in `components/layout/nav-items.ts`.
- Reuse `formatMoney`, `StatusBadge`, `confirmAction`, `FormActions`, button rules from CLAUDE.md.

## Verification
- Unit (fake repos): poValue recompute, sanity flags (rate/qty/unit/not-in-BOQ/unordered), deadline derivation, extraction mapping with Ollama stubbed.
- Integration: convert won tender → create client PO with PDF → overview returns tender/RFQ/vendor/PO data; non-won tender rejected.
- Anonymised fixtures only (public repo).
- `pnpm typecheck` (dev server stopped), `pnpm lint`, `pnpm test`; `graphify update .`. No browser check unless asked.

## Phase B design (2026-11-19)

**Data**
- `PurchaseOrderItem.boqItemId` (unenforced snapshot ref): copied from `RfqItem.boqItemId` on create-from-RFQ, pickable on the manual PO form when a tender is chosen; backfilled for existing RFQ-sourced POs by matching description within the source RFQ. Vendor procurement ↔ client order are joined on boqItemId.
- `Shipment` (per project, numbered 1..n): clientPurchaseOrderId, e-way bill no./date, vehicle, transporter, freightCost, dispatchedAt, grnNumber/grnDate, billId (unique FK to `Bill`), settledAt, notes. `ShipmentItem`: clientPoItemId (FK Restrict) + quantity. Documents via `AttachmentsService` (`entityType "Shipment"`, documentType EWAY_BILL / TECHNICAL / GRN / OTHER).
- Client PO update now upserts lines by id (it used to delete + recreate), so a shipped line keeps its id; removing a shipped line is a 409.

**Stage (derived, never stored)**: PREPARING → DISPATCHED (dispatchedAt) → GRN_RECEIVED (grnNumber) → BILLED (billId) → PAID (settledAt).

**Endpoints**: `GET /projects/:id/supply` (per-BOQ-line progress: ordered, procured, received, dispatched, accepted + shipments); `POST /projects/:id/shipments`; `PATCH|DELETE /shipments/:id`; `POST /shipments/:id/dispatch|grn|bill|payments|documents|undo`. Bill reuses `BillsService.createBill` (client PO rates, GRN no./date). Payment = `Payment` entityType "Bill", direction RECEIVED, no cap at the bill total (bills carry no GST yet, and clients deduct TDS/LD), `settled` flag sets settledAt.

**RBAC**: `shipments:read|create|update|delete` (Tender/Project manager, Accounts); bill route also needs `bills:create`, payment route `finance:create`.

**UI**: project "Supply" tab: item progress table (with Receive on vendor POs via existing `GoodsReceiptDialog`) + a board of shipment cards in stage columns, each card's button performs the next stage in a dialog.

## Phase C (built 2026-11-19)
- Reports "Project Costing" became **Project Profit** (`GET /reports/project-costing?projectId=`, same report key/export).
- Per project, derived on read: client PO value (Σ client PO lines), billed (Σ bills on the tender), received (Σ RECEIVED payments on those bills), vendor POs (Σ issued/received vendor PO lines on the tender), freight (Σ `Shipment.freightCost`), other costs (Σ project expenses + legacy labour entries).
- Profit so far = received − total cost; expected profit = client PO value − total cost; margin % of received.
- Cancelled projects left out. Old budget/variance columns dropped from the report (project budget field kept).
- Project page gets a **Profit** tab (money in / money out / profit) from the same endpoint.
- Known limit: freight recorded both on a shipment and as a TRANSPORT expense counts twice (UI note tells users to pick one).

## Phase D (built 2026-11-19)
- `POST /projects/:projectId/documents/read` (file + optional `kind`): reads an e-way bill, GRN or vendor invoice; nothing saved.
- Kind = whichever title phrase appears first (each document quotes the others). Dialogs pass the kind explicitly.
- **SAIL IISCO exception**: documents mentioning IISCO / Steel Authority of India go to `readIiscoDocument` (deterministic, per kind). No parser exists yet; user will supply sample files. Until then the AI model reads them, with a warning saying so.
- Matching: e-way bill/GRN to the project's client PO by number, then to shipments waiting in Preparing/Dispatched (one = clear match; already-recorded numbers warn). Vendor invoice to the tender's vendor PO by number, with a total check.
- UI: Supply tab "Read a document" opens the dispatch/GRN dialog prefilled with the file attached; both dialogs also get "Fill from file". Vendor invoice links to the vendor PO.
- Not done: line quantities from documents, storing vendor invoices on the vendor PO, scanned-image OCR.
