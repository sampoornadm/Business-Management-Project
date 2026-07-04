import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type {
  BankAccountRow,
  CreateBankAccountData,
  CreateExpenseData,
  CreateInvoiceData,
  CreatePaymentData,
  ExpenseRow,
  IFinanceRepository,
  InvoiceRow,
  PaymentRow,
  UpdateBankAccountData,
  UpdateExpenseData,
  UpdateInvoiceData,
} from "../finance.repository.js";
import { FinanceService } from "../finance.service.js";

const CREATOR = { id: randomUUID(), firstName: "Anita", lastName: "Accounts" };

class FakeFinanceRepository implements IFinanceRepository {
  bankAccounts = new Map<string, BankAccountRow>();
  invoices = new Map<string, InvoiceRow>();
  expenses = new Map<string, ExpenseRow>();
  payments: PaymentRow[] = [];
  poTotals = new Map<string, number>();

  async createBankAccount(data: CreateBankAccountData) {
    const id = randomUUID();
    this.bankAccounts.set(id, {
      id,
      name: data.name,
      accountNumber: data.accountNumber ?? null,
      bankName: data.bankName ?? null,
      ifscCode: data.ifscCode ?? null,
      openingBalance: data.openingBalance ?? 0,
      isActive: true,
      createdById: data.createdById,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as BankAccountRow);
    return id;
  }

  async findBankAccountById(id: string) {
    return this.bankAccounts.get(id) ?? null;
  }

  async findBankAccounts() {
    return [...this.bankAccounts.values()];
  }

  async updateBankAccount(id: string, data: UpdateBankAccountData) {
    const account = this.bankAccounts.get(id);
    if (!account) throw new Error("not found");
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    Object.assign(account, defined);
  }

  async deleteBankAccount(id: string) {
    this.bankAccounts.delete(id);
  }

  async createInvoice(data: CreateInvoiceData) {
    const id = randomUUID();
    this.invoices.set(id, {
      id,
      invoiceNumber: data.invoiceNumber,
      projectId: data.projectId ?? null,
      sourceBillId: data.sourceBillId ?? null,
      clientName: data.clientName,
      subtotal: data.subtotal,
      gstPercent: data.gstPercent,
      gstAmount: data.gstAmount,
      totalAmount: data.totalAmount,
      status: "DRAFT",
      invoiceDate: data.invoiceDate ?? new Date(),
      dueDate: data.dueDate ?? null,
      notes: data.notes ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as InvoiceRow);
    return id;
  }

  async findInvoiceById(id: string) {
    return this.invoices.get(id) ?? null;
  }

  async findInvoices() {
    const items = [...this.invoices.values()];
    return { items, totalItems: items.length };
  }

  async findAllInvoices() {
    return [...this.invoices.values()];
  }

  async updateInvoice(id: string, data: UpdateInvoiceData) {
    const invoice = this.invoices.get(id);
    if (!invoice) throw new Error("not found");
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    Object.assign(invoice, defined);
  }

  async createExpense(data: CreateExpenseData) {
    const id = randomUUID();
    this.expenses.set(id, {
      id,
      category: data.category,
      description: data.description,
      amount: data.amount,
      expenseDate: data.expenseDate ?? new Date(),
      projectId: data.projectId ?? null,
      vendorId: data.vendorId ?? null,
      status: "UNPAID",
      notes: data.notes ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ExpenseRow);
    return id;
  }

  async findExpenseById(id: string) {
    return this.expenses.get(id) ?? null;
  }

  async findExpenses() {
    const items = [...this.expenses.values()];
    return { items, totalItems: items.length };
  }

  async findAllExpenses() {
    return [...this.expenses.values()];
  }

  async updateExpense(id: string, data: UpdateExpenseData) {
    const expense = this.expenses.get(id);
    if (!expense) throw new Error("not found");
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    Object.assign(expense, defined);
  }

  async createPayment(data: CreatePaymentData) {
    this.payments.push({
      id: randomUUID(),
      direction: data.direction,
      amount: data.amount,
      paymentDate: data.paymentDate ?? new Date(),
      method: data.method,
      bankAccountId: data.bankAccountId ?? null,
      referenceNumber: data.referenceNumber ?? null,
      entityType: data.entityType,
      entityId: data.entityId,
      remarks: data.remarks ?? null,
      recordedBy: CREATOR,
      createdAt: new Date(),
    } as unknown as PaymentRow);
  }

  async findPaymentsForEntity(entityType: string, entityId: string) {
    return this.payments.filter((p) => p.entityType === entityType && p.entityId === entityId);
  }

  async sumPaymentsForEntity(entityType: string, entityId: string) {
    return this.payments
      .filter((p) => p.entityType === entityType && p.entityId === entityId)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  async sumAllPaymentsByEntityType(entityType: string) {
    return this.payments.filter((p) => p.entityType === entityType).reduce((sum, p) => sum + p.amount, 0);
  }

  async findPaymentsByMethod(method: string) {
    return this.payments.filter((p) => p.method === method);
  }

  async findPaymentsByBankAccount(bankAccountId: string) {
    return this.payments.filter((p) => p.bankAccountId === bankAccountId);
  }

  async findPurchaseOrderTotal(purchaseOrderId: string) {
    return this.poTotals.get(purchaseOrderId) ?? null;
  }

  async sumOpenPurchaseOrderTotals() {
    return [...this.poTotals.values()].reduce((sum, total) => sum + total, 0);
  }

  async findBillForInvoice(billId: string) {
    return this.bills.get(billId) ?? null;
  }

  bills = new Map<string, { id: string; projectId: string; currentBillAmount: number }>();
}

describe("FinanceService", () => {
  let repository: FakeFinanceRepository;
  let auditService: AuditService;
  let service: FinanceService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeFinanceRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new FinanceService(repository as unknown as IFinanceRepository, auditService);
  });

  it("computes gstAmount and totalAmount from subtotal and gstPercent", async () => {
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-1", clientName: "PWD", subtotal: 100000, gstPercent: 18 },
      actorId,
    );
    expect(invoice.gstAmount).toBe(18000);
    expect(invoice.totalAmount).toBe(118000);
  });

  it("creates an invoice from a project bill using its currentBillAmount as subtotal", async () => {
    const projectId = randomUUID();
    repository.bills.set("bill-1", { id: "bill-1", projectId, currentBillAmount: 50000 });
    const invoice = await service.createInvoiceFromBill(
      { billId: "bill-1", invoiceNumber: "INV-2", clientName: "PWD" },
      actorId,
    );
    expect(invoice.subtotal).toBe(50000);
    expect(invoice.sourceBillId).toBe("bill-1");
    expect(invoice.projectId).toBe(projectId);
  });

  it("moves an invoice through PARTIALLY_PAID to PAID across two payments", async () => {
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-3", clientName: "PWD", subtotal: 100000, gstPercent: 0 },
      actorId,
    );
    const afterFirst = await service.recordInvoicePayment(
      invoice.id,
      { amount: 40000, method: "CASH" },
      actorId,
    );
    expect(afterFirst.status).toBe("PARTIALLY_PAID");
    expect(afterFirst.amountPaid).toBe(40000);

    const afterSecond = await service.recordInvoicePayment(
      invoice.id,
      { amount: 60000, method: "CASH" },
      actorId,
    );
    expect(afterSecond.status).toBe("PAID");
    expect(afterSecond.amountPaid).toBe(100000);
    expect(afterSecond.payments).toHaveLength(2);
  });

  it("rejects a payment that would overpay an invoice", async () => {
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-4", clientName: "PWD", subtotal: 100000, gstPercent: 0 },
      actorId,
    );
    await expect(
      service.recordInvoicePayment(invoice.id, { amount: 150000, method: "CASH" }, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("requires a bankAccountId for non-cash payment methods", async () => {
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-5", clientName: "PWD", subtotal: 100000, gstPercent: 0 },
      actorId,
    );
    await expect(
      service.recordInvoicePayment(invoice.id, { amount: 1000, method: "BANK_TRANSFER" }, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("moves an expense to PAID once fully paid", async () => {
    const expense = await service.createExpense(
      { category: "MATERIAL", description: "Cement bags", amount: 20000 },
      actorId,
    );
    const paid = await service.recordExpensePayment(expense.id, { amount: 20000, method: "CASH" }, actorId);
    expect(paid.status).toBe("PAID");
  });

  it("records a purchase order payment without needing an invoice or expense", async () => {
    const poId = randomUUID();
    repository.poTotals.set(poId, 75000);
    const payments = await service.recordPurchaseOrderPayment(
      poId,
      { amount: 75000, method: "CASH" },
      actorId,
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]!.amount).toBe(75000);
  });

  it("rejects a purchase order payment for an unknown PO", async () => {
    await expect(
      service.recordPurchaseOrderPayment(randomUUID(), { amount: 1000, method: "CASH" }, actorId),
    ).rejects.toThrow(NotFoundError);
  });

  it("computes bank account balance from opening balance plus payments", async () => {
    const account = await service.createBankAccount(
      { name: "HDFC Current", openingBalance: 10000 },
      actorId,
    );
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-6", clientName: "PWD", subtotal: 50000, gstPercent: 0 },
      actorId,
    );
    await service.recordInvoicePayment(
      invoice.id,
      { amount: 50000, method: "BANK_TRANSFER", bankAccountId: account.id },
      actorId,
    );
    const updated = await service.getBankAccount(account.id);
    expect(updated.currentBalance).toBe(60000);
  });

  it("blocks deleting a bank account that has recorded payments", async () => {
    const account = await service.createBankAccount({ name: "HDFC Current" }, actorId);
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-7", clientName: "PWD", subtotal: 1000, gstPercent: 0 },
      actorId,
    );
    await service.recordInvoicePayment(
      invoice.id,
      { amount: 1000, method: "BANK_TRANSFER", bankAccountId: account.id },
      actorId,
    );
    await expect(service.deleteBankAccount(account.id, actorId)).rejects.toThrow(ConflictError);
  });

  it("computes the finance summary across invoices, expenses, and purchase orders", async () => {
    const invoice = await service.createInvoice(
      { invoiceNumber: "INV-8", clientName: "PWD", subtotal: 100000, gstPercent: 0 },
      actorId,
    );
    await service.recordInvoicePayment(invoice.id, { amount: 40000, method: "CASH" }, actorId);

    const expense = await service.createExpense(
      { category: "OFFICE", description: "Stationery", amount: 5000 },
      actorId,
    );
    await service.recordExpensePayment(expense.id, { amount: 2000, method: "CASH" }, actorId);

    const summary = await service.getSummary();
    expect(summary.totalReceivables).toBe(60000);
    expect(summary.totalPayables).toBe(3000);
    expect(summary.cashBalance).toBe(40000 - 2000);
  });

  it("throws for an unknown invoice id", async () => {
    await expect(service.getInvoice(randomUUID())).rejects.toThrow(NotFoundError);
  });
});
