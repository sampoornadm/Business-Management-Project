"use client";

import type {
  ApiResponse,
  BankAccountDto,
  CashBookEntryDto,
  CreateBankAccountInput,
  CreateExpenseInput,
  CreateInvoiceFromBillInput,
  CreateInvoiceInput,
  CreatePaymentInput,
  ExpenseDto,
  ExpenseListItemDto,
  FinanceSummaryDto,
  InvoiceDto,
  InvoiceListItemDto,
  ListExpensesQuery,
  ListInvoicesQuery,
  PaginatedResult,
  UpdateBankAccountInput,
  UpdateExpenseInput,
  UpdateInvoiceInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

// Bank accounts
export function useBankAccounts(activeOnly?: boolean) {
  return useQuery({
    queryKey: ["bank-accounts", activeOnly],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BankAccountDto[]>>("/bank-accounts", {
        params: activeOnly ? { activeOnly: "true" } : undefined,
      });
      return unwrap(response.data);
    },
  });
}

export function useBankAccount(id: string | undefined) {
  return useQuery({
    queryKey: ["bank-accounts", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BankAccountDto>>(`/bank-accounts/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBankAccountInput) => {
      const response = await apiClient.post<ApiResponse<BankAccountDto>>("/bank-accounts", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
  });
}

export function useUpdateBankAccount(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBankAccountInput) => {
      const response = await apiClient.patch<ApiResponse<BankAccountDto>>(`/bank-accounts/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
  });
}

export function useDeleteBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/bank-accounts/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
    },
  });
}

// Invoices
export function useInvoices(query: ListInvoicesQuery) {
  return useQuery({
    queryKey: ["invoices", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<InvoiceListItemDto>>>("/invoices", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ["invoices", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<InvoiceDto>>(`/invoices/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const response = await apiClient.post<ApiResponse<InvoiceDto>>("/invoices", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useCreateInvoiceFromBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInvoiceFromBillInput) => {
      const response = await apiClient.post<ApiResponse<InvoiceDto>>("/invoices/from-bill", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useUpdateInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateInvoiceInput) => {
      const response = await apiClient.patch<ApiResponse<InvoiceDto>>(`/invoices/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] });
    },
  });
}

export function useRecordInvoicePayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const response = await apiClient.post<ApiResponse<InvoiceDto>>(`/invoices/${id}/payments`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "summary"] });
    },
  });
}

// Expenses
export function useExpenses(query: ListExpensesQuery) {
  return useQuery({
    queryKey: ["expenses", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<ExpenseListItemDto>>>("/expenses", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ["expenses", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ExpenseDto>>(`/expenses/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const response = await apiClient.post<ApiResponse<ExpenseDto>>("/expenses", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });
}

export function useUpdateExpense(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateExpenseInput) => {
      const response = await apiClient.patch<ApiResponse<ExpenseDto>>(`/expenses/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", id] });
    },
  });
}

export function useRecordExpensePayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const response = await apiClient.post<ApiResponse<ExpenseDto>>(`/expenses/${id}/payments`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses", id] });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "summary"] });
    },
  });
}

// Reports
export function useFinanceSummary() {
  return useQuery({
    queryKey: ["finance", "summary"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<FinanceSummaryDto>>("/finance/summary");
      return unwrap(response.data);
    },
  });
}

export function useCashBook() {
  return useQuery({
    queryKey: ["finance", "cash-book"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CashBookEntryDto[]>>("/finance/cash-book");
      return unwrap(response.data);
    },
  });
}

export function useBankBook(bankAccountId: string | undefined) {
  return useQuery({
    queryKey: ["finance", "bank-book", bankAccountId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CashBookEntryDto[]>>(
        `/finance/bank-book/${bankAccountId}`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(bankAccountId),
  });
}
