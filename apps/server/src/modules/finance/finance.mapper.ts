import type {
  BankAccountDto,
  ExpenseDto,
  ExpenseListItemDto,
  InvoiceDto,
  InvoiceListItemDto,
  PayableEntityType,
  PaymentDto,
} from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

import type { BankAccountRow, ExpenseRow, InvoiceRow, PaymentRow } from "./finance.repository.js";

export function toBankAccountDto(entity: BankAccountRow, currentBalance: number): BankAccountDto {
  return {
    id: entity.id,
    name: entity.name,
    accountNumber: entity.accountNumber,
    bankName: entity.bankName,
    ifscCode: entity.ifscCode,
    openingBalance: entity.openingBalance,
    currentBalance: round2(currentBalance),
    isActive: entity.isActive,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toPaymentDto(entity: PaymentRow): PaymentDto {
  return {
    id: entity.id,
    direction: entity.direction,
    amount: entity.amount,
    paymentDate: entity.paymentDate.toISOString(),
    method: entity.method,
    bankAccountId: entity.bankAccountId,
    referenceNumber: entity.referenceNumber,
    entityType: entity.entityType as PayableEntityType,
    entityId: entity.entityId,
    remarks: entity.remarks,
    recordedBy: {
      id: entity.recordedBy.id,
      firstName: entity.recordedBy.firstName,
      lastName: entity.recordedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toInvoiceListItemDto(entity: InvoiceRow, amountPaid: number): InvoiceListItemDto {
  return {
    id: entity.id,
    invoiceNumber: entity.invoiceNumber,
    projectId: entity.projectId,
    clientName: entity.clientName,
    totalAmount: entity.totalAmount,
    amountPaid: round2(amountPaid),
    status: entity.status,
    invoiceDate: entity.invoiceDate.toISOString(),
    dueDate: entity.dueDate ? entity.dueDate.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toInvoiceDto(entity: InvoiceRow, amountPaid: number, payments: PaymentRow[]): InvoiceDto {
  return {
    ...toInvoiceListItemDto(entity, amountPaid),
    sourceBillId: entity.sourceBillId,
    subtotal: entity.subtotal,
    gstPercent: entity.gstPercent,
    gstAmount: entity.gstAmount,
    notes: entity.notes,
    payments: payments.map(toPaymentDto),
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toExpenseListItemDto(entity: ExpenseRow, amountPaid: number): ExpenseListItemDto {
  return {
    id: entity.id,
    category: entity.category,
    description: entity.description,
    amount: entity.amount,
    amountPaid: round2(amountPaid),
    status: entity.status,
    expenseDate: entity.expenseDate.toISOString(),
    projectId: entity.projectId,
    vendorId: entity.vendorId,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toExpenseDto(entity: ExpenseRow, amountPaid: number, payments: PaymentRow[]): ExpenseDto {
  return {
    ...toExpenseListItemDto(entity, amountPaid),
    notes: entity.notes,
    payments: payments.map(toPaymentDto),
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    updatedAt: entity.updatedAt.toISOString(),
  };
}
