import { randomUUID } from "node:crypto";

import type {
  BankAccount,
  ExpenseCategory,
  ExpenseStatus,
  InvoiceStatus,
  PaymentDirection,
  PaymentMethod,
  Prisma,
  PrismaClient,
} from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;

export type BankAccountRow = BankAccount;

export interface CreateBankAccountData {
  name: string;
  accountNumber?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  openingBalance?: number;
  createdById: string;
}
export type UpdateBankAccountData = Partial<Omit<CreateBankAccountData, "createdById">> & {
  isActive?: boolean;
};

const invoiceArgs = {
  include: { createdBy: { select: creatorSelect } },
} satisfies Prisma.InvoiceDefaultArgs;
export type InvoiceRow = Prisma.InvoiceGetPayload<typeof invoiceArgs>;

export interface CreateInvoiceData {
  invoiceNumber: string;
  projectId?: string | null;
  sourceBillId?: string | null;
  clientName: string;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  totalAmount: number;
  invoiceDate?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  createdById: string;
}
export type UpdateInvoiceData = Partial<{
  clientName: string;
  dueDate: Date | null;
  notes: string | null;
  status: InvoiceStatus;
}>;

export interface InvoiceFilters {
  status?: InvoiceStatus;
  projectId?: string;
}

const expenseArgs = {
  include: { createdBy: { select: creatorSelect } },
} satisfies Prisma.ExpenseDefaultArgs;
export type ExpenseRow = Prisma.ExpenseGetPayload<typeof expenseArgs>;

export interface CreateExpenseData {
  category: ExpenseCategory;
  description: string;
  amount: number;
  expenseDate?: Date;
  projectId?: string | null;
  vendorId?: string | null;
  notes?: string | null;
  createdById: string;
}
export type UpdateExpenseData = Partial<Omit<CreateExpenseData, "createdById">> & { status?: ExpenseStatus };

export interface ExpenseFilters {
  status?: ExpenseStatus;
  category?: ExpenseCategory;
  projectId?: string;
  vendorId?: string;
}

const paymentArgs = {
  include: { recordedBy: { select: creatorSelect } },
} satisfies Prisma.PaymentDefaultArgs;
export type PaymentRow = Prisma.PaymentGetPayload<typeof paymentArgs>;

export interface CreatePaymentData {
  direction: PaymentDirection;
  amount: number;
  method: PaymentMethod;
  bankAccountId?: string | null;
  referenceNumber?: string | null;
  paymentDate?: Date;
  entityType: string;
  entityId: string;
  remarks?: string | null;
  recordedById: string;
}

export interface IFinanceRepository {
  createBankAccount(data: CreateBankAccountData): Promise<string>;
  findBankAccountById(id: string): Promise<BankAccountRow | null>;
  findBankAccounts(activeOnly?: boolean): Promise<BankAccountRow[]>;
  updateBankAccount(id: string, data: UpdateBankAccountData): Promise<void>;
  deleteBankAccount(id: string): Promise<void>;

  createInvoice(data: CreateInvoiceData): Promise<string>;
  findInvoiceById(id: string): Promise<InvoiceRow | null>;
  findInvoices(
    pagination: PaginationParams,
    filters: InvoiceFilters,
  ): Promise<{ items: InvoiceRow[]; totalItems: number }>;
  findAllInvoices(): Promise<InvoiceRow[]>;
  updateInvoice(id: string, data: UpdateInvoiceData): Promise<void>;

  createExpense(data: CreateExpenseData): Promise<string>;
  findExpenseById(id: string): Promise<ExpenseRow | null>;
  findExpenses(
    pagination: PaginationParams,
    filters: ExpenseFilters,
  ): Promise<{ items: ExpenseRow[]; totalItems: number }>;
  findAllExpenses(): Promise<ExpenseRow[]>;
  updateExpense(id: string, data: UpdateExpenseData): Promise<void>;

  createPayment(data: CreatePaymentData): Promise<void>;
  findPaymentsForEntity(entityType: string, entityId: string): Promise<PaymentRow[]>;
  sumPaymentsForEntity(entityType: string, entityId: string): Promise<number>;
  sumAllPaymentsByEntityType(entityType: string): Promise<number>;
  findPaymentsByMethod(method: PaymentMethod): Promise<PaymentRow[]>;
  findPaymentsByBankAccount(bankAccountId: string): Promise<PaymentRow[]>;

  findPurchaseOrderTotal(purchaseOrderId: string): Promise<number | null>;
  sumOpenPurchaseOrderTotals(): Promise<number>;
  findBillForInvoice(
    billId: string,
  ): Promise<{ id: string; projectId: string; currentBillAmount: number } | null>;
}

export class FinanceRepository implements IFinanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBankAccount(data: CreateBankAccountData): Promise<string> {
    const id = randomUUID();
    await this.prisma.bankAccount.create({ data: { id, ...data } });
    return id;
  }

  findBankAccountById(id: string): Promise<BankAccountRow | null> {
    return this.prisma.bankAccount.findUnique({ where: { id } });
  }

  findBankAccounts(activeOnly = false): Promise<BankAccountRow[]> {
    return this.prisma.bankAccount.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: "asc" },
    });
  }

  async updateBankAccount(id: string, data: UpdateBankAccountData): Promise<void> {
    await this.prisma.bankAccount.update({ where: { id }, data });
  }

  async deleteBankAccount(id: string): Promise<void> {
    await this.prisma.bankAccount.delete({ where: { id } });
  }

  async createInvoice(data: CreateInvoiceData): Promise<string> {
    const id = randomUUID();
    await this.prisma.invoice.create({ data: { id, ...data } });
    return id;
  }

  findInvoiceById(id: string): Promise<InvoiceRow | null> {
    return this.prisma.invoice.findUnique({ where: { id }, ...invoiceArgs });
  }

  async findInvoices(
    pagination: PaginationParams,
    filters: InvoiceFilters,
  ): Promise<{ items: InvoiceRow[]; totalItems: number }> {
    const where: Prisma.InvoiceWhereInput = { status: filters.status, projectId: filters.projectId };
    const [items, totalItems] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        ...invoiceArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items, totalItems };
  }

  findAllInvoices(): Promise<InvoiceRow[]> {
    return this.prisma.invoice.findMany(invoiceArgs);
  }

  async updateInvoice(id: string, data: UpdateInvoiceData): Promise<void> {
    await this.prisma.invoice.update({ where: { id }, data });
  }

  async createExpense(data: CreateExpenseData): Promise<string> {
    const id = randomUUID();
    await this.prisma.expense.create({ data: { id, ...data } });
    return id;
  }

  findExpenseById(id: string): Promise<ExpenseRow | null> {
    return this.prisma.expense.findUnique({ where: { id }, ...expenseArgs });
  }

  async findExpenses(
    pagination: PaginationParams,
    filters: ExpenseFilters,
  ): Promise<{ items: ExpenseRow[]; totalItems: number }> {
    const where: Prisma.ExpenseWhereInput = {
      status: filters.status,
      category: filters.category,
      projectId: filters.projectId,
      vendorId: filters.vendorId,
    };
    const [items, totalItems] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        ...expenseArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.expense.count({ where }),
    ]);
    return { items, totalItems };
  }

  findAllExpenses(): Promise<ExpenseRow[]> {
    return this.prisma.expense.findMany(expenseArgs);
  }

  async updateExpense(id: string, data: UpdateExpenseData): Promise<void> {
    await this.prisma.expense.update({ where: { id }, data });
  }

  async createPayment(data: CreatePaymentData): Promise<void> {
    await this.prisma.payment.create({ data: { id: randomUUID(), ...data } });
  }

  findPaymentsForEntity(entityType: string, entityId: string): Promise<PaymentRow[]> {
    return this.prisma.payment.findMany({
      where: { entityType, entityId },
      orderBy: { paymentDate: "asc" },
      ...paymentArgs,
    });
  }

  async sumPaymentsForEntity(entityType: string, entityId: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { entityType, entityId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async sumAllPaymentsByEntityType(entityType: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { entityType },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  findPaymentsByMethod(method: PaymentMethod): Promise<PaymentRow[]> {
    return this.prisma.payment.findMany({
      where: { method },
      orderBy: { paymentDate: "asc" },
      ...paymentArgs,
    });
  }

  findPaymentsByBankAccount(bankAccountId: string): Promise<PaymentRow[]> {
    return this.prisma.payment.findMany({
      where: { bankAccountId },
      orderBy: { paymentDate: "asc" },
      ...paymentArgs,
    });
  }

  async findPurchaseOrderTotal(purchaseOrderId: string): Promise<number | null> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { id: true },
    });
    if (!po) return null;
    const result = await this.prisma.purchaseOrderItem.aggregate({
      where: { purchaseOrderId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async sumOpenPurchaseOrderTotals(): Promise<number> {
    const result = await this.prisma.purchaseOrderItem.aggregate({
      where: { purchaseOrder: { status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] } } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  findBillForInvoice(
    billId: string,
  ): Promise<{ id: string; projectId: string; currentBillAmount: number } | null> {
    return this.prisma.projectBill.findUnique({
      where: { id: billId },
      select: { id: true, projectId: true, currentBillAmount: true },
    });
  }
}
