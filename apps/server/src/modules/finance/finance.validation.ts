import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, INVOICE_STATUSES, PAYMENT_METHODS } from "@bmp/types";
import { z } from "zod";

const dateSchema = z.string().datetime().or(z.string().date());

export const createBankAccountSchema = z.object({
  name: z.string().min(1).max(200),
  accountNumber: z.string().max(50).optional(),
  bankName: z.string().max(200).optional(),
  ifscCode: z.string().max(20).optional(),
  openingBalance: z.number().optional(),
});
export type CreateBankAccountBody = z.infer<typeof createBankAccountSchema>;

export const updateBankAccountSchema = createBankAccountSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateBankAccountBody = z.infer<typeof updateBankAccountSchema>;

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(50),
  projectId: z.string().uuid().optional(),
  clientName: z.string().min(1).max(200),
  subtotal: z.number().nonnegative(),
  gstPercent: z.number().min(0).max(100).optional(),
  invoiceDate: dateSchema.optional(),
  dueDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateInvoiceBody = z.infer<typeof createInvoiceSchema>;

export const createInvoiceFromBillSchema = z.object({
  billId: z.string().uuid(),
  invoiceNumber: z.string().min(1).max(50),
  clientName: z.string().min(1).max(200),
  gstPercent: z.number().min(0).max(100).optional(),
  dueDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateInvoiceFromBillBody = z.infer<typeof createInvoiceFromBillSchema>;

export const updateInvoiceSchema = z.object({
  clientName: z.string().min(1).max(200).optional(),
  dueDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceSchema>;

export const listInvoicesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  projectId: z.string().uuid().optional(),
});
export type ListInvoicesQueryParsed = z.infer<typeof listInvoicesQuerySchema>;

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  expenseDate: dateSchema.optional(),
  projectId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  projectId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
});
export type ListExpensesQueryParsed = z.infer<typeof listExpensesQuerySchema>;

export const createPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  bankAccountId: z.string().uuid().optional(),
  referenceNumber: z.string().max(100).optional(),
  paymentDate: dateSchema.optional(),
  remarks: z.string().max(1000).optional(),
});
export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;
