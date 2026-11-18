"use client";

import type {
  ApiResponse,
  ClientPurchaseOrderDto,
  ClientPurchaseOrderExtractionDto,
  CreateClientPurchaseOrderInput,
  ProjectClientPurchaseOrdersDto,
  UpdateClientPurchaseOrderInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

const key = (projectId: string) => ["projects", projectId, "client-purchase-orders"];

export function useProjectClientPurchaseOrders(projectId: string | undefined) {
  return useQuery({
    queryKey: key(projectId ?? ""),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectClientPurchaseOrdersDto>>(
        `/projects/${projectId}/client-purchase-orders`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

export function useExtractClientPurchaseOrder(projectId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<ClientPurchaseOrderExtractionDto>>(
        `/projects/${projectId}/client-purchase-orders/extract`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
  });
}

/** Saves the PO, then attaches its document when one was picked. */
export function useSaveClientPurchaseOrder(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      input,
      file,
    }: {
      orderId?: string;
      input: CreateClientPurchaseOrderInput | UpdateClientPurchaseOrderInput;
      file?: File | null;
    }) => {
      const response = orderId
        ? await apiClient.patch<ApiResponse<ClientPurchaseOrderDto>>(`/client-purchase-orders/${orderId}`, input)
        : await apiClient.post<ApiResponse<ClientPurchaseOrderDto>>(
            `/projects/${projectId}/client-purchase-orders`,
            input,
          );
      const order = unwrap(response.data);
      if (!file) return order;
      const formData = new FormData();
      formData.append("file", file);
      const uploaded = await apiClient.post<ApiResponse<ClientPurchaseOrderDto>>(
        `/client-purchase-orders/${order.id}/document`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(uploaded.data);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(projectId) }),
  });
}

export function useDeleteClientPurchaseOrder(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => {
      await apiClient.delete(`/client-purchase-orders/${orderId}`);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(projectId) }),
  });
}
