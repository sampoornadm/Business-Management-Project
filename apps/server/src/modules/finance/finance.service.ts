import type {
  BankAccountDto,
  CashBookEntryDto,
  CreateBankAccountInput,
  CreateExpenseInput,
  CreateInvoiceFromBillInput,
  CreateInvoiceInput,
  CreatePaymentInput,
  ExpenseDto,
  ExpenseListItemDto,
  ExpenseStatus,
  FinanceSummaryDto,
  InvoiceDto,
  InvoiceListItemDto,
  InvoiceStatus,
  PaginatedResult,
  PayableEntityType,
  PaymentDto,
  UpdateBankAccountInput,
  UpdateExpenseInput,
  UpdateInvoiceInput,
} from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import { round2 } from "../../shared/utils/math.js";
import type { AuditService } from "../audit/audit.service.js";

import {
  toBankAccountDto,
  toExpenseDto,
  toExpenseListItemDto,
  toInvoiceDto,
  toInvoiceListItemDto,
  toPaymentDto,
} from "./finance.mapper.js";
import type {
  BankAccountRow,
  ExpenseFilters,
  ExpenseRow,
  IFinanceRepository,
  InvoiceFilters,
  InvoiceRow,
} from "./finance.repository.js";

const EPSILON = 1e-6;

export class FinanceService {
  constructor(
    private readonly financeRepository: IFinanceRepository,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------
  // Bank accounts
  // ---------------------------------------------------------------------

  private async computeBankBalance(account: BankAccountRow, businessId: string): Promise<number> {
    const payments = await this.financeRepository.findPaymentsByBankAccount(account.id, businessId);
    const received = payments.filter((p) => p.direction === "RECEIVED").reduce((s, p) => s + p.amount, 0);
    const paid = payments.filter((p) => p.direction === "PAID").reduce((s, p) => s + p.amount, 0);
    return round2(account.openingBalance + received - paid);
  }

  async listBankAccounts(businessId: string, activeOnly?: boolean): Promise<BankAccountDto[]> {
    const accounts = await this.financeRepository.findBankAccounts(businessId, activeOnly);
    return Promise.all(
      accounts.map(async (account) =>
        toBankAccountDto(account, await this.computeBankBalance(account, businessId)),
      ),
    );
  }

  async getBankAccount(id: string, businessId: string): Promise<BankAccountDto> {
    const account = await this.financeRepository.findBankAccountById(id, businessId);
    if (!account) throw new NotFoundError("Bank account not found");
    return toBankAccountDto(account, await this.computeBankBalance(account, businessId));
  }

  async createBankAccount(
    input: CreateBankAccountInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<BankAccountDto> {
    const id = await this.financeRepository.createBankAccount({
      ...input,
      businessId: context.businessId,
      createdById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "BANK_ACCOUNT_CREATED",
      entityType: "BankAccount",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getBankAccount(id, context.businessId);
  }

  async updateBankAccount(
    id: string,
    input: UpdateBankAccountInput,
    actorId: string,
    businessId: string,
  ): Promise<BankAccountDto> {
    const existing = await this.financeRepository.findBankAccountById(id, businessId);
    if (!existing) throw new NotFoundError("Bank account not found");
    await this.financeRepository.updateBankAccount(id, input);
    await this.auditService.log({
      actorId,
      action: "BANK_ACCOUNT_UPDATED",
      entityType: "BankAccount",
      entityId: id,
    });
    return this.getBankAccount(id, businessId);
  }

  async deleteBankAccount(id: string, actorId: string, businessId: string): Promise<void> {
    const existing = await this.financeRepository.findBankAccountById(id, businessId);
    if (!existing) throw new NotFoundError("Bank account not found");
    const payments = await this.financeRepository.findPaymentsByBankAccount(id, businessId);
    if (payments.length > 0) {
      throw new ConflictError(`Cannot delete this bank account: it has ${payments.length} recorded payment(s)`);
    }
    await this.financeRepository.deleteBankAccount(id);
    await this.auditService.log({
      actorId,
      action: "BANK_ACCOUNT_DELETED",
      entityType: "BankAccount",
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------

  private async getInvoiceOrThrow(id: string, businessId: string): Promise<InvoiceRow> {
    const invoice = await this.financeRepository.findInvoiceById(id, businessId);
    if (!invoice) throw new NotFoundError("Invoice not found");
    return invoice;
  }

  async listInvoices(
    pagination: PaginationParams,
    filters: InvoiceFilters,
  ): Promise<PaginatedResult<InvoiceListItemDto>> {
    const { items, totalItems } = await this.financeRepository.findInvoices(pagination, filters);
    const dtos = await Promise.all(
      items.map(async (invoice) =>
        toInvoiceListItemDto(
          invoice,
          await this.financeRepository.sumPaymentsForEntity("Invoice", invoice.id, filters.businessId),
        ),
      ),
    );
    return buildPaginatedResult(dtos, totalItems, pagination);
  }

  async getInvoice(id: string, businessId: string): Promise<InvoiceDto> {
    const invoice = await this.getInvoiceOrThrow(id, businessId);
    const [amountPaid, payments] = await Promise.all([
      this.financeRepository.sumPaymentsForEntity("Invoice", id, businessId),
      this.financeRepository.findPaymentsForEntity("Invoice", id, businessId),
    ]);
    return toInvoiceDto(invoice, amountPaid, payments);
  }

  async createInvoice(
    input: CreateInvoiceInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<InvoiceDto> {
    const gstPercent = input.gstPercent ?? 18;
    const gstAmount = round2((input.subtotal * gstPercent) / 100);
    const totalAmount = round2(input.subtotal + gstAmount);

    const id = await this.financeRepository.createInvoice({
      invoiceNumber: input.invoiceNumber,
      projectId: input.projectId ?? null,
      sourceBillId: null,
      clientName: input.clientName,
      subtotal: input.subtotal,
      gstPercent,
      gstAmount,
      totalAmount,
      invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : undefined,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes,
      businessId: context.businessId,
      createdById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "INVOICE_CREATED",
      entityType: "Invoice",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getInvoice(id, context.businessId);
  }

  async createInvoiceFromBill(
    input: CreateInvoiceFromBillInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<InvoiceDto> {
    const bill = await this.financeRepository.findBillForInvoice(input.billId, context.businessId);
    if (!bill) throw new BadRequestError("Invalid billId");

    const gstPercent = input.gstPercent ?? 18;
    const subtotal = bill.currentBillAmount;
    const gstAmount = round2((subtotal * gstPercent) / 100);
    const totalAmount = round2(subtotal + gstAmount);

    const id = await this.financeRepository.createInvoice({
      invoiceNumber: input.invoiceNumber,
      projectId: bill.projectId,
      sourceBillId: bill.id,
      clientName: input.clientName,
      subtotal,
      gstPercent,
      gstAmount,
      totalAmount,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      notes: input.notes,
      businessId: context.businessId,
      createdById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "INVOICE_CREATED_FROM_BILL",
      entityType: "Invoice",
      entityId: id,
      metadata: { billId: bill.id },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getInvoice(id, context.businessId);
  }

  async updateInvoice(
    id: string,
    input: UpdateInvoiceInput,
    actorId: string,
    businessId: string,
  ): Promise<InvoiceDto> {
    await this.getInvoiceOrThrow(id, businessId);
    await this.financeRepository.updateInvoice(id, {
      clientName: input.clientName,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
      status: input.status,
    });
    await this.auditService.log({ actorId, action: "INVOICE_UPDATED", entityType: "Invoice", entityId: id });
    return this.getInvoice(id, businessId);
  }

  // ---------------------------------------------------------------------
  // Expenses
  // ---------------------------------------------------------------------

  private async getExpenseOrThrow(id: string, businessId: string): Promise<ExpenseRow> {
    const expense = await this.financeRepository.findExpenseById(id, businessId);
    if (!expense) throw new NotFoundError("Expense not found");
    return expense;
  }

  async listExpenses(
    pagination: PaginationParams,
    filters: ExpenseFilters,
  ): Promise<PaginatedResult<ExpenseListItemDto>> {
    const { items, totalItems } = await this.financeRepository.findExpenses(pagination, filters);
    const dtos = await Promise.all(
      items.map(async (expense) =>
        toExpenseListItemDto(
          expense,
          await this.financeRepository.sumPaymentsForEntity("Expense", expense.id, filters.businessId),
        ),
      ),
    );
    return buildPaginatedResult(dtos, totalItems, pagination);
  }

  async getExpense(id: string, businessId: string): Promise<ExpenseDto> {
    const expense = await this.getExpenseOrThrow(id, businessId);
    const [amountPaid, payments] = await Promise.all([
      this.financeRepository.sumPaymentsForEntity("Expense", id, businessId),
      this.financeRepository.findPaymentsForEntity("Expense", id, businessId),
    ]);
    return toExpenseDto(expense, amountPaid, payments);
  }

  async createExpense(
    input: CreateExpenseInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<ExpenseDto> {
    const id = await this.financeRepository.createExpense({
      category: input.category,
      description: input.description,
      amount: input.amount,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : undefined,
      projectId: input.projectId ?? null,
      vendorId: input.vendorId ?? null,
      notes: input.notes,
      businessId: context.businessId,
      createdById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "EXPENSE_CREATED",
      entityType: "Expense",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getExpense(id, context.businessId);
  }

  async updateExpense(
    id: string,
    input: UpdateExpenseInput,
    actorId: string,
    businessId: string,
  ): Promise<ExpenseDto> {
    await this.getExpenseOrThrow(id, businessId);
    await this.financeRepository.updateExpense(id, {
      category: input.category,
      description: input.description,
      amount: input.amount,
      expenseDate: input.expenseDate ? new Date(input.expenseDate) : undefined,
      projectId: input.projectId,
      vendorId: input.vendorId,
      notes: input.notes,
    });
    await this.auditService.log({ actorId, action: "EXPENSE_UPDATED", entityType: "Expense", entityId: id });
    return this.getExpense(id, businessId);
  }

  // ---------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------

  private async validateAndCreatePayment(params: {
    entityType: PayableEntityType;
    entityId: string;
    total: number;
    direction: "RECEIVED" | "PAID";
    input: CreatePaymentInput;
    actorId: string;
    businessId: string;
  }): Promise<number> {
    if (params.input.amount <= 0) throw new BadRequestError("amount must be positive");
    if (params.input.method !== "CASH" && !params.input.bankAccountId) {
      throw new BadRequestError("bankAccountId is required for non-cash payment methods");
    }

    const alreadyPaid = await this.financeRepository.sumPaymentsForEntity(
      params.entityType,
      params.entityId,
      params.businessId,
    );
    const newTotalPaid = round2(alreadyPaid + params.input.amount);
    if (newTotalPaid > params.total + EPSILON) {
      throw new BadRequestError(
        `Payment would exceed the total amount owed (${params.total}); already paid ${alreadyPaid}`,
      );
    }

    await this.financeRepository.createPayment({
      direction: params.direction,
      amount: params.input.amount,
      method: params.input.method,
      bankAccountId: params.input.bankAccountId ?? null,
      referenceNumber: params.input.referenceNumber,
      paymentDate: params.input.paymentDate ? new Date(params.input.paymentDate) : undefined,
      entityType: params.entityType,
      entityId: params.entityId,
      remarks: params.input.remarks,
      businessId: params.businessId,
      recordedById: params.actorId,
    });

    await this.auditService.log({
      actorId: params.actorId,
      action: "PAYMENT_RECORDED",
      entityType: params.entityType,
      entityId: params.entityId,
      metadata: { amount: params.input.amount, direction: params.direction },
    });
    return newTotalPaid;
  }

  async recordInvoicePayment(
    invoiceId: string,
    input: CreatePaymentInput,
    actorId: string,
    businessId: string,
  ): Promise<InvoiceDto> {
    const invoice = await this.getInvoiceOrThrow(invoiceId, businessId);
    const newTotalPaid = await this.validateAndCreatePayment({
      entityType: "Invoice",
      entityId: invoiceId,
      total: invoice.totalAmount,
      direction: "RECEIVED",
      input,
      actorId,
      businessId,
    });
    const status: InvoiceStatus = newTotalPaid >= invoice.totalAmount - EPSILON ? "PAID" : "PARTIALLY_PAID";
    await this.financeRepository.updateInvoice(invoiceId, { status });
    return this.getInvoice(invoiceId, businessId);
  }

  async recordExpensePayment(
    expenseId: string,
    input: CreatePaymentInput,
    actorId: string,
    businessId: string,
  ): Promise<ExpenseDto> {
    const expense = await this.getExpenseOrThrow(expenseId, businessId);
    const newTotalPaid = await this.validateAndCreatePayment({
      entityType: "Expense",
      entityId: expenseId,
      total: expense.amount,
      direction: "PAID",
      input,
      actorId,
      businessId,
    });
    const status: ExpenseStatus = newTotalPaid >= expense.amount - EPSILON ? "PAID" : "PARTIALLY_PAID";
    await this.financeRepository.updateExpense(expenseId, { status });
    return this.getExpense(expenseId, businessId);
  }

  async recordPurchaseOrderPayment(
    purchaseOrderId: string,
    input: CreatePaymentInput,
    actorId: string,
    businessId: string,
  ): Promise<PaymentDto[]> {
    const total = await this.financeRepository.findPurchaseOrderTotal(purchaseOrderId, businessId);
    if (total === null) throw new NotFoundError("Purchase order not found");
    await this.validateAndCreatePayment({
      entityType: "PurchaseOrder",
      entityId: purchaseOrderId,
      total,
      direction: "PAID",
      input,
      actorId,
      businessId,
    });
    const payments = await this.financeRepository.findPaymentsForEntity(
      "PurchaseOrder",
      purchaseOrderId,
      businessId,
    );
    return payments.map(toPaymentDto);
  }

  async listPurchaseOrderPayments(purchaseOrderId: string, businessId: string): Promise<PaymentDto[]> {
    const payments = await this.financeRepository.findPaymentsForEntity(
      "PurchaseOrder",
      purchaseOrderId,
      businessId,
    );
    return payments.map(toPaymentDto);
  }

  // ---------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------

  async getSummary(businessId: string): Promise<FinanceSummaryDto> {
    const [invoices, expenses, poPayables, invoicePaid, expensePaid, poPaid, bankAccounts, cashPayments] =
      await Promise.all([
        this.financeRepository.findAllInvoices(businessId),
        this.financeRepository.findAllExpenses(businessId),
        this.financeRepository.sumOpenPurchaseOrderTotals(businessId),
        this.financeRepository.sumAllPaymentsByEntityType("Invoice", businessId),
        this.financeRepository.sumAllPaymentsByEntityType("Expense", businessId),
        this.financeRepository.sumAllPaymentsByEntityType("PurchaseOrder", businessId),
        this.financeRepository.findBankAccounts(businessId),
        this.financeRepository.findPaymentsByMethod("CASH", businessId),
      ]);

    const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);
    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    const totalReceivables = round2(totalInvoiced - invoicePaid);
    const totalPayables = round2(totalExpenses + poPayables - expensePaid - poPaid);

    const cashReceived = cashPayments
      .filter((p) => p.direction === "RECEIVED")
      .reduce((sum, p) => sum + p.amount, 0);
    const cashPaid = cashPayments.filter((p) => p.direction === "PAID").reduce((sum, p) => sum + p.amount, 0);

    const bankBalances = await Promise.all(
      bankAccounts.map(async (account) => ({
        bankAccountId: account.id,
        name: account.name,
        balance: await this.computeBankBalance(account, businessId),
      })),
    );

    return {
      totalReceivables,
      totalPayables,
      cashBalance: round2(cashReceived - cashPaid),
      bankBalances,
    };
  }

  async getCashBook(businessId: string): Promise<CashBookEntryDto[]> {
    const payments = await this.financeRepository.findPaymentsByMethod("CASH", businessId);
    let running = 0;
    return payments.map((p) => {
      running += p.direction === "RECEIVED" ? p.amount : -p.amount;
      return {
        id: p.id,
        direction: p.direction,
        amount: p.amount,
        method: p.method,
        paymentDate: p.paymentDate.toISOString(),
        entityType: p.entityType as PayableEntityType,
        entityId: p.entityId,
        referenceNumber: p.referenceNumber,
        remarks: p.remarks,
        runningBalance: round2(running),
      };
    });
  }

  async getBankBook(bankAccountId: string, businessId: string): Promise<CashBookEntryDto[]> {
    const account = await this.financeRepository.findBankAccountById(bankAccountId, businessId);
    if (!account) throw new NotFoundError("Bank account not found");

    const payments = await this.financeRepository.findPaymentsByBankAccount(bankAccountId, businessId);
    let running = account.openingBalance;
    return payments.map((p) => {
      running += p.direction === "RECEIVED" ? p.amount : -p.amount;
      return {
        id: p.id,
        direction: p.direction,
        amount: p.amount,
        method: p.method,
        paymentDate: p.paymentDate.toISOString(),
        entityType: p.entityType as PayableEntityType,
        entityId: p.entityId,
        referenceNumber: p.referenceNumber,
        remarks: p.remarks,
        runningBalance: round2(running),
      };
    });
  }
}
