# BMP — Phase 6 (Finance) Implementation Plan

## Context

Phases 1–5 (Foundation, Tender Management, BOQ & Estimation, Procurement, Project Execution) are
complete and verified. Phase 6 covers the master spec's Finance module. Per `spec.md`: "Expenses,
invoices, payments, GST, cash/bank books, financial reports."

## Scope decisions

- **Money fields stay `Float`**, per the standing decision recorded in `CLAUDE.md` at Phase 2 — this
  phase is the one that was flagged as needing to "revisit... real ledger precision," but doing so now
  would mean touching every prior phase's monetary columns (Tender, Boq, PurchaseOrder, Project...).
  That's a cross-cutting migration, not a Finance-module feature, and is explicitly out of scope here;
  flagged again below for Phase 8 (Production Readiness) instead.
- **`Payment` is one polymorphic table, not three.** A payment either comes in against an `Invoice` or
  goes out against an `Expense` or a `PurchaseOrder` — same `entityType`/`entityId` generic-reference
  convention already used by `Attachment` and `AuditLog`, rather than three separate payment tables or
  three FK columns on one table. `direction` (RECEIVED/PAID) is stored explicitly rather than inferred
  from entityType, so a report can filter on it directly without a join.
- **Cash/bank "books" are a computed read over `Payment`, not a separate ledger table** — same
  "computed, don't duplicate" principle as BOQ comparison and project costing. A `BankAccount` holds
  an `openingBalance`; its running balance is `openingBalance + Σ RECEIVED - Σ PAID` for payments
  tagged with that account (or the implicit "Cash" account when `method = CASH`).
- **Invoice/Expense status is server-derived from recorded payments**, not set directly — mirrors the
  Purchase Order pattern from Phase 4 (`DRAFT → ... → RECEIVED` derived from goods receipts):
  `UNPAID → PARTIALLY_PAID → PAID` derived by comparing Σ payments to the invoice/expense total.
- **Invoices can optionally originate from a Phase 5 `ProjectBill`** (one-to-one, nullable link) to
  formalize an approved RA bill into a GST invoice, or be created standalone for non-project billing
  (e.g. a one-off service). Either way, `Invoice` snapshots its own `subtotal`/`gstPercent` — no
  live-join back to the bill for the numbers, same snapshot discipline as every prior cross-entity
  reference in this codebase.
- **One `finance` permission set, not per-entity ones.** Unlike Phase 4 (vendors/rfq/purchase_orders
  are distinct enough workflows to warrant separate keys), bank accounts/invoices/expenses/payments
  are all one Accounts-department responsibility per the spec ("Manages bills, payments, invoices,
  taxes, GST, and financial reports") — a single `finance:{create,read,update,delete}` keeps the
  permission matrix from fragmenting into a dozen near-identical keys for one role's job.
- **Financial reports are computed reads.** `GET /finance/summary` (total receivables, total payables,
  per-account cash/bank balance) and `GET /finance/cash-book` / `GET /finance/bank-book/:accountId`
  (payment history + running balance for an account) are aggregation endpoints, no new tables.

## Prisma schema additions

```prisma
model BankAccount {
  id             String   @id @default(uuid())
  name           String
  accountNumber  String?
  bankName       String?
  ifscCode       String?
  openingBalance Float    @default(0)
  isActive       Boolean  @default(true)

  createdById String
  createdBy   User   @relation("BankAccountCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  payments Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum InvoiceStatus { DRAFT SENT PARTIALLY_PAID PAID OVERDUE }

model Invoice {
  id            String        @id @default(uuid())
  invoiceNumber String        @unique
  projectId     String?
  project       Project?      @relation(fields: [projectId], references: [id], onDelete: SetNull)
  sourceBillId  String?       @unique
  sourceBill    ProjectBill?  @relation(fields: [sourceBillId], references: [id], onDelete: SetNull)
  clientName    String
  subtotal      Float
  gstPercent    Float         @default(18)
  gstAmount     Float         // server-computed: subtotal * gstPercent / 100
  totalAmount   Float         // server-computed: subtotal + gstAmount
  status        InvoiceStatus @default(DRAFT)
  invoiceDate   DateTime      @default(now())
  dueDate       DateTime?
  notes         String?

  createdById String
  createdBy   User   @relation("InvoiceCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum ExpenseCategory { MATERIAL LABOR TRANSPORT EQUIPMENT OFFICE OTHER }
enum ExpenseStatus { UNPAID PARTIALLY_PAID PAID }

model Expense {
  id          String          @id @default(uuid())
  category    ExpenseCategory
  description String
  amount      Float
  expenseDate DateTime        @default(now())
  projectId   String?
  project     Project?        @relation(fields: [projectId], references: [id], onDelete: SetNull)
  vendorId    String?
  vendor      Vendor?         @relation(fields: [vendorId], references: [id], onDelete: SetNull)
  status      ExpenseStatus   @default(UNPAID)
  notes       String?

  createdById String
  createdBy   User   @relation("ExpenseCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum PaymentDirection { RECEIVED PAID }
enum PaymentMethod { CASH BANK_TRANSFER CHEQUE UPI CARD }

model Payment {
  id              String           @id @default(uuid())
  direction       PaymentDirection
  amount          Float
  paymentDate     DateTime         @default(now())
  method          PaymentMethod
  bankAccountId   String?
  bankAccount     BankAccount?     @relation(fields: [bankAccountId], references: [id], onDelete: SetNull)
  referenceNumber String?
  entityType      String           // "Invoice" | "Expense" | "PurchaseOrder"
  entityId        String
  remarks         String?

  recordedById String
  recordedBy   User   @relation("PaymentRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([entityType, entityId])
  @@index([bankAccountId])
}
```

`Project` gains `invoices Invoice[]` and `expenses Expense[]` back-relations; `ProjectBill` gains
`invoice Invoice?`; `Vendor` gains `expenses Expense[]`; `User` gains `createdBankAccounts
BankAccount[]`, `createdInvoices Invoice[]`, `createdExpenses Expense[]`, `recordedPayments
Payment[]`.

## Backend module (`apps/server/src/modules/finance/`)

Single module, several sub-resources (mirrors `projects/`). Key service logic: invoice/expense
`gstAmount`/`totalAmount` always server-computed from `subtotal`/`gstPercent` (never trust client
math); recording a payment against an invoice/expense recomputes its status by comparing Σ payments
to the total (`UNPAID` → `PARTIALLY_PAID` → `PAID`), same derivation style as PO goods-receipt status;
a payment against a `PurchaseOrder` only validates that the PO exists (no PO-side status change —
"paid" tracking is a Finance concern, delivery status stays a Procurement concern per Phase 4).

Endpoints:

| Method & Path | Permission |
|---|---|
| POST/GET/PATCH/DELETE /bank-accounts(/:id) | `finance:create` / `:read` / `:update` / `:delete` |
| POST/GET/PATCH /invoices(/:id) | `finance:create` / `:read` / `:update` |
| POST /invoices/from-bill | `finance:create` |
| POST/GET/PATCH /expenses(/:id) | `finance:create` / `:read` / `:update` |
| POST /invoices/:id/payments, /expenses/:id/payments, /purchase-orders/:id/payments | `finance:create` |
| GET /finance/summary | `finance:read` |
| GET /finance/cash-book, GET /finance/bank-book/:bankAccountId | `finance:read` |

RBAC addition: `finance:{create,read,update,delete}`. Accounts gets full access (their core job);
Tender Manager/Estimator/Purchase Manager/Project Manager get read-only (cross-functional financial
visibility); Viewer read-only.

## Frontend

- `apps/web/src/app/(dashboard)/finance/page.tsx` — the financial-reports dashboard (summary cards:
  total receivables, total payables, cash balance, per-bank-account balances) plus tabs for
  Invoices/Expenses/Bank Accounts (lists) and a Cash/Bank Book view (transaction history + running
  balance, account picker).
- `apps/web/src/app/(dashboard)/finance/invoices/[id]/page.tsx` and `.../expenses/[id]/page.tsx` —
  detail pages with a "Record payment" dialog (amount/method/bank account/reference) and payment
  history.
- Project detail page gains an "Create Invoice from this bill" action next to each `PAID`-eligible
  bill in the Bills tab (Phase 5) — reuses the same "convert" pattern as tender→project.
- Purchase Order detail page (Phase 4) gains a "Record payment" action once `RECEIVED`.
- Nav addition: Finance (`finance:read`).

## Testing

Unit tests (fake repos): invoice `gstAmount`/`totalAmount` computed from `subtotal`/`gstPercent`;
invoice/expense status derivation across multiple partial payments (UNPAID → PARTIALLY_PAID → PAID);
rejects a payment that would overpay an invoice/expense beyond its total (mirrors the PO
over-receiving guard from Phase 4); bank/cash balance computed from opening balance + payments.
Integration test: create a bank account, create an invoice, record two partial payments reaching
PAID, record an expense and a payment against it, confirm `/finance/summary` and `/finance/bank-book`
reflect the correct numbers.

## Build order

1. Prisma schema additions + migration + RBAC matrix update
2. `finance/` module: bank accounts → invoices (incl. from-bill) → expenses → payments (against all
   three entity types) → summary/cash-book/bank-book reads
3. Backend tests
4. Frontend: finance dashboard + invoice/expense detail pages + payment dialogs + PO/bill "create
   payment/invoice" entry points on existing Phase 4/5 pages
5. Typecheck, lint, build, test across the full monorepo
6. Browser walkthrough: create a bank account, create an invoice from the Phase 5 project's bill,
   record a partial and final payment, create an expense against the Phase 4 vendor and pay it,
   confirm the finance summary and bank book numbers

## Critical files (once built)

- `packages/database/prisma/schema.prisma`
- `apps/server/src/modules/finance/finance.service.ts` (GST computation, status derivation, balance
  aggregation)
- `packages/types/src/finance.ts`, `packages/types/src/rbac.ts`

Phases 7–8 (Reporting & Intelligence, Production Readiness) remain out of scope and will each get
their own plan once Phase 6 is verified working end-to-end. Note for Phase 8: revisit `Float` vs
`Decimal` for monetary columns platform-wide once the schema is otherwise stable.

## Status: shipped and verified

Built as planned, no scope deviations. Verified: full monorepo lint/typecheck/build clean (web
build/typecheck run sequentially per the established `.next` race gotcha); 120/120 backend tests
passing (12 new finance unit tests covering GST computation, invoice/expense status derivation across
partial payments, overpayment rejection, non-cash-requires-bank-account validation, bank balance
computation, and summary aggregation; 4 new integration tests covering bank account creation,
invoice creation + two-payment reconciliation to PAID, expense creation + full cash payment, and the
summary/bank-book endpoints against a real Postgres). Browser walkthrough (Accounts role): created a
bank account, created an invoice and recorded two payments reaching PAID, created and paid an expense
in cash, confirmed the finance dashboard's receivables/payables/cash-balance/bank-balance numbers all
updated correctly — including payables correctly picking up real outstanding Purchase Order totals
left over from the Phase 4 walkthrough, confirming the cross-phase aggregation reads live data rather
than a stale snapshot.
