import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  switchToSecondBusiness,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Finance workflow (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let bankAccountId: string;
  let invoiceId: string;
  let expenseId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
  });

  afterAll(async () => {
    if (invoiceId) {
      await prisma.payment.deleteMany({ where: { entityType: "Invoice", entityId: invoiceId } });
      await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    }
    if (expenseId) {
      await prisma.payment.deleteMany({ where: { entityType: "Expense", entityId: expenseId } });
      await prisma.expense.deleteMany({ where: { id: expenseId } });
    }
    if (bankAccountId) await prisma.bankAccount.deleteMany({ where: { id: bankAccountId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("creates a bank account", async () => {
    const response = await request(app)
      .post("/api/v1/bank-accounts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "Integration Bank " + Date.now(), openingBalance: 10000 });
    expect(response.status).toBe(201);
    expect(response.body.data.currentBalance).toBe(10000);
    bankAccountId = response.body.data.id;
  });

  it("creates an invoice and records two partial payments reaching PAID", async () => {
    const createResponse = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ invoiceNumber: "INV-INT-" + Date.now(), clientName: "PWD", subtotal: 100000, gstPercent: 18 });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.totalAmount).toBe(118000);
    invoiceId = createResponse.body.data.id;

    const firstPayment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ amount: 50000, method: "BANK_TRANSFER", bankAccountId });
    expect(firstPayment.status).toBe(201);
    expect(firstPayment.body.data.status).toBe("PARTIALLY_PAID");

    const secondPayment = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payments`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ amount: 68000, method: "BANK_TRANSFER", bankAccountId });
    expect(secondPayment.status).toBe(201);
    expect(secondPayment.body.data.status).toBe("PAID");

    const bankAccountResponse = await request(app)
      .get(`/api/v1/bank-accounts/${bankAccountId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(bankAccountResponse.body.data.currentBalance).toBe(10000 + 118000);
  });

  it("creates an expense and pays it fully via cash", async () => {
    const createResponse = await request(app)
      .post("/api/v1/expenses")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ category: "OFFICE", description: "Printer paper", amount: 2000 });
    expect(createResponse.status).toBe(201);
    expenseId = createResponse.body.data.id;

    const paymentResponse = await request(app)
      .post(`/api/v1/expenses/${expenseId}/payments`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ amount: 2000, method: "CASH" });
    expect(paymentResponse.status).toBe(201);
    expect(paymentResponse.body.data.status).toBe("PAID");
  });

  it("reflects the invoice and expense in the finance summary and bank book", async () => {
    const summaryResponse = await request(app)
      .get("/api/v1/finance/summary")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totalReceivables).toBe(0);

    const bankBookResponse = await request(app)
      .get(`/api/v1/finance/bank-book/${bankAccountId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(bankBookResponse.status).toBe(200);
    expect(bankBookResponse.body.data).toHaveLength(2);
    expect(bankBookResponse.body.data.at(-1).runningBalance).toBe(10000 + 118000);

    const cashBookResponse = await request(app)
      .get("/api/v1/finance/cash-book")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(cashBookResponse.status).toBe(200);
  });
});

describe("Finance business isolation (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    const businessIds = [testUser.businessId, testUser.secondBusinessId];
    await prisma.payment.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.invoice.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.expense.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.bankAccount.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { businessId: { in: businessIds } } });
    // Vendor has no businessId column of its own — cleaned up by creator instead.
    await prisma.vendor.deleteMany({ where: { createdById: testUser.userId } });
    await prisma.projectBill.deleteMany({ where: { createdById: testUser.userId } });
    await prisma.project.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.tender.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.organization.deleteMany({ where: { createdById: testUser.userId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("does not return a bank account from another business, and rejects direct access", async () => {
    const createResponse = await request(app)
      .post("/api/v1/bank-accounts")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ name: `Isolation Bank ${randomUUID().slice(0, 8)}`, openingBalance: 5000 });
    expect(createResponse.status).toBe(201);
    const isolationAccountId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const listResponse = await request(app)
      .get("/api/v1/bank-accounts")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.map((a: { id: string }) => a.id)).not.toContain(isolationAccountId);

    const getByIdResponse = await request(app)
      .get(`/api/v1/bank-accounts/${isolationAccountId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getByIdResponse.status).toBe(404);
  });

  it("does not return an expense from another business, and rejects direct access", async () => {
    const createResponse = await request(app)
      .post("/api/v1/expenses")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        category: "MATERIAL",
        description: `Isolation expense ${randomUUID().slice(0, 8)}`,
        amount: 1000,
      });
    expect(createResponse.status).toBe(201);
    const isolationExpenseId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const listResponse = await request(app)
      .get("/api/v1/expenses")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.map((e: { id: string }) => e.id)).not.toContain(isolationExpenseId);

    const getByIdResponse = await request(app)
      .get(`/api/v1/expenses/${isolationExpenseId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getByIdResponse.status).toBe(404);
  });

  it("rejects a mutating request (purchase order payment) against another business's purchase order", async () => {
    // findPurchaseOrderTotal() previously looked the PO up by id with no
    // businessId scope at all, so any business could record a payment
    // against any other business's purchase order (up to its total). This
    // exercises that exact route to guard against it regressing, and
    // confirms no payment was actually recorded (not merely hidden from the
    // response), mirroring the procurement module's isolation regressions.
    const vendorResponse = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ name: `Finance Isolation Vendor ${randomUUID().slice(0, 8)}`, category: "MATERIAL_SUPPLIER" });
    expect(vendorResponse.status).toBe(201);
    const vendorId = vendorResponse.body.data.id as string;

    const poResponse = await request(app)
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        vendorId,
        items: [{ description: "OPC Cement", unit: "bag", quantity: 100, rate: 380 }],
      });
    expect(poResponse.status).toBe(201);
    const isolationPoId = poResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const paymentResponse = await request(app)
      .post(`/api/v1/purchase-orders/${isolationPoId}/payments`)
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({ amount: 1000, method: "CASH" });
    expect(paymentResponse.status).toBe(404);

    const paymentsListResponse = await request(app)
      .get(`/api/v1/purchase-orders/${isolationPoId}/payments`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(paymentsListResponse.status).toBe(200);
    expect(paymentsListResponse.body.data).toHaveLength(0);
  });

  it("rejects creating an invoice from another business's project bill", async () => {
    // findBillForInvoice() previously looked the bill up by id alone — any
    // business could read another business's exact billed amount (and its
    // real projectId) and stamp both onto a new invoice of their own. This
    // confirms the fix rejects it, and that no such leaked invoice exists.
    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Finance Isolation Client ${randomUUID().slice(0, 8)}`,
        type: "GOVERNMENT",
        createdById: testUser.userId,
      },
    });
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `TND-FIN-ISO-${randomUUID().slice(0, 8)}`,
        title: "Finance Isolation Tender",
        department: "PWD",
        clientId: organization.id,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(),
        status: "WON",
        createdById: testUser.userId,
      },
    });
    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderId: tender.id,
        name: "Finance Isolation Project",
        budget: 500000,
        startDate: new Date(),
        createdById: testUser.userId,
      },
    });
    const bill = await prisma.projectBill.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        billNumber: "RA-ISO-1",
        cumulativeAmount: 90000,
        currentBillAmount: 90000,
        createdById: testUser.userId,
      },
    });

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const invoiceResponse = await request(app)
      .post("/api/v1/invoices/from-bill")
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({
        billId: bill.id,
        invoiceNumber: `INV-ISO-${randomUUID().slice(0, 8)}`,
        clientName: "Should not work",
      });
    expect(invoiceResponse.status).toBe(400);

    const leakedInvoice = await prisma.invoice.findFirst({ where: { sourceBillId: bill.id } });
    expect(leakedInvoice).toBeNull();
  });

  it("does not reflect another business's invoices, expenses, or payments in the finance summary and cash book", async () => {
    // sumAllPaymentsByEntityType(), findPaymentsByMethod(), findAllInvoices(),
    // findAllExpenses(), and sumOpenPurchaseOrderTotals() previously had no
    // businessId scope at all, so getSummary()/getCashBook() would blend
    // every business's totals together.
    const invoiceResponse = await request(app)
      .post("/api/v1/invoices")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        invoiceNumber: `INV-ISO-SUM-${randomUUID().slice(0, 8)}`,
        clientName: "PWD",
        subtotal: 20000,
        gstPercent: 0,
      });
    expect(invoiceResponse.status).toBe(201);
    const isolationInvoiceId = invoiceResponse.body.data.id as string;

    const invoicePaymentResponse = await request(app)
      .post(`/api/v1/invoices/${isolationInvoiceId}/payments`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ amount: 20000, method: "CASH" });
    expect(invoicePaymentResponse.status).toBe(201);

    const expenseResponse = await request(app)
      .post("/api/v1/expenses")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ category: "OFFICE", description: "Isolation summary expense", amount: 5000 });
    expect(expenseResponse.status).toBe(201);

    const expensePaymentResponse = await request(app)
      .post(`/api/v1/expenses/${expenseResponse.body.data.id}/payments`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ amount: 5000, method: "CASH" });
    expect(expensePaymentResponse.status).toBe(201);

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const summaryResponse = await request(app)
      .get("/api/v1/finance/summary")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body.data.totalReceivables).toBe(0);
    expect(summaryResponse.body.data.totalPayables).toBe(0);
    expect(summaryResponse.body.data.cashBalance).toBe(0);

    const cashBookResponse = await request(app)
      .get("/api/v1/finance/cash-book")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(cashBookResponse.status).toBe(200);
    expect(cashBookResponse.body.data).toHaveLength(0);
  });
});
