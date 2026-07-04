"use client";

import type {
  ApiResponse,
  CreateGoodsReceiptInput,
  CreatePaymentInput,
  CreatePurchaseOrderFromRfqInput,
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  PaginatedResult,
  PaymentDto,
  PurchaseOrderDto,
  PurchaseOrderListItemDto,
  UpdatePurchaseOrderStatusInput,
  UpsertVendorRatingInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function usePurchaseOrders(query: ListPurchaseOrdersQuery) {
  return useQuery({
    queryKey: ["purchase-orders", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<PurchaseOrderListItemDto>>>(
        "/purchase-orders",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function usePurchaseOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["purchase-orders", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PurchaseOrderDto>>(`/purchase-orders/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

function invalidatePo(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["purchase-orders", id] });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePurchaseOrderInput) => {
      const response = await apiClient.post<ApiResponse<PurchaseOrderDto>>("/purchase-orders", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useCreatePurchaseOrderFromRfq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePurchaseOrderFromRfqInput) => {
      const response = await apiClient.post<ApiResponse<PurchaseOrderDto>>(
        "/purchase-orders/from-rfq",
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useUpdatePurchaseOrderStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePurchaseOrderStatusInput) => {
      const response = await apiClient.patch<ApiResponse<PurchaseOrderDto>>(
        `/purchase-orders/${id}/status`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidatePo(queryClient, id),
  });
}

export function useCreateGoodsReceipt(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateGoodsReceiptInput) => {
      const response = await apiClient.post<ApiResponse<PurchaseOrderDto>>(
        `/purchase-orders/${id}/goods-receipts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidatePo(queryClient, id),
  });
}

export function useUpsertVendorRating(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertVendorRatingInput) => {
      const response = await apiClient.put<ApiResponse<PurchaseOrderDto>>(
        `/purchase-orders/${id}/vendor-rating`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidatePo(queryClient, id),
  });
}

export function usePurchaseOrderPayments(id: string | undefined) {
  return useQuery({
    queryKey: ["purchase-orders", id, "payments"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaymentDto[]>>(`/purchase-orders/${id}/payments`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useRecordPurchaseOrderPayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePaymentInput) => {
      const response = await apiClient.post<ApiResponse<PaymentDto[]>>(
        `/purchase-orders/${id}/payments`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders", id, "payments"] });
      void queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      void queryClient.invalidateQueries({ queryKey: ["finance", "summary"] });
    },
  });
}
