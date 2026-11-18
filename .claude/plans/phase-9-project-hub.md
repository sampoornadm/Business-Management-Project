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
