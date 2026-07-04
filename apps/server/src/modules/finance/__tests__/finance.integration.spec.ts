import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { WILDCARD_PERMISSION } from "@bmp/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { hashPassword } from "../../../shared/utils/hash.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Finance workflow (integration)", () => {
  const app = createApp();
  const email = `finance-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let bankAccountId: string;
  let invoiceId: string;
  let expenseId: string;

  beforeAll(async () => {
    const permission = await prisma.permission.upsert({
      where: { key: WILDCARD_PERMISSION },
      update: {},
      create: { id: randomUUID(), key: WILDCARD_PERMISSION, resource: "*", action: "*" },
    });

    const role = await prisma.role.upsert({
      where: { name: "SUPER_ADMIN" },
      update: {},
      create: { id: randomUUID(), name: "SUPER_ADMIN", description: "Super Admin", isSystem: true },
    });

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { id: randomUUID(), roleId: role.id, permissionId: permission.id },
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        firstName: "Finance",
        lastName: "Tester",
        roleId: role.id,
        isActive: true,
        isEmailVerified: true,
      },
    });

    const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = loginResponse.body.data.accessToken;
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
    await prisma.user.deleteMany({ where: { email } });
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
