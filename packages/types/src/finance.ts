export const INVOICE_STATUSES = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "MATERIAL",
  "LABOR",
  "TRANSPORT",
  "EQUIPMENT",
  "OFFICE",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const PAYMENT_DIRECTIONS = ["RECEIVED", "PAID"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "UPI", "CARD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Entities a Payment can be recorded against — mirrors Attachment's entityType/entityId convention. */
export const PAYABLE_ENTITY_TYPES = ["Invoice", "Expense", "PurchaseOrder"] as const;
export type PayableEntityType = (typeof PAYABLE_ENTITY_TYPES)[number];

export interface BankAccountDto {
  id: string;
  name: string;
  accountNumber: string | null;
  bankName: string | null;
  ifscCode: string | null;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
}

export interface CreateBankAccountInput {
  name: string;
  accountNumber?: string;
  bankName?: string;
  ifscCode?: string;
  openingBalance?: number;
}

export type UpdateBankAccountInput = Partial<CreateBankAccountInput> & { isActive?: boolean };

export interface PaymentDto {
  id: string;
  direction: PaymentDirection;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  bankAccountId: string | null;
  referenceNumber: string | null;
  entityType: PayableEntityType;
  entityId: string;
  remarks: string | null;
  recordedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface CreatePaymentInput {
  amount: number;
  method: PaymentMethod;
  bankAccountId?: string;
  referenceNumber?: string;
  paymentDate?: string;
  remarks?: string;
}

export interface InvoiceListItemDto {
  id: string;
  invoiceNumber: string;
  projectId: string | null;
  clientName: string;
  totalAmount: number;
  amountPaid: number;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string | null;
  createdAt: string;
}

export interface InvoiceDto extends InvoiceListItemDto {
  sourceBillId: string | null;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  notes: string | null;
  payments: PaymentDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface CreateInvoiceInput {
  invoiceNumber: string;
  projectId?: string;
  clientName: string;
  subtotal: number;
  gstPercent?: number;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string;
}

export interface CreateInvoiceFromBillInput {
  billId: string;
  invoiceNumber: string;
  clientName: string;
  gstPercent?: number;
  dueDate?: string;
  notes?: string;
}

export type UpdateInvoiceInput = Partial<
  Pick<CreateInvoiceInput, "clientName" | "dueDate" | "notes"> & { status: InvoiceStatus }
>;

export interface ListInvoicesQuery {
  page?: number;
  pageSize?: number;
  status?: InvoiceStatus;
  projectId?: string;
}

export interface ExpenseListItemDto {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  amountPaid: number;
  status: ExpenseStatus;
  expenseDate: string;
  projectId: string | null;
  vendorId: string | null;
  createdAt: string;
}

export interface ExpenseDto extends ExpenseListItemDto {
  notes: string | null;
  payments: PaymentDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface CreateExpenseInput {
  category: ExpenseCategory;
  description: string;
  amount: number;
  expenseDate?: string;
  projectId?: string;
  vendorId?: string;
  notes?: string;
}

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export interface ListExpensesQuery {
  page?: number;
  pageSize?: number;
  status?: ExpenseStatus;
  category?: ExpenseCategory;
  projectId?: string;
  vendorId?: string;
}

export interface FinanceBankBalanceDto {
  bankAccountId: string;
  name: string;
  balance: number;
}

export interface FinanceSummaryDto {
  totalReceivables: number;
  totalPayables: number;
  cashBalance: number;
  bankBalances: FinanceBankBalanceDto[];
}

export interface CashBookEntryDto {
  id: string;
  direction: PaymentDirection;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  entityType: PayableEntityType;
  entityId: string;
  referenceNumber: string | null;
  remarks: string | null;
  runningBalance: number;
}
