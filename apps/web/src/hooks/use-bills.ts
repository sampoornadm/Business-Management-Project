"use client";

import type {
  ApiResponse,
  BillDto,
  BillListItemDto,
  CreateBillInput,
  ListBillsQuery,
  PaginatedResult,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useBills(query: ListBillsQuery) {
  return useQuery({
    queryKey: ["bills", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<BillListItemDto>>>("/bills", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: ["bills", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BillDto>>(`/bills/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBillInput) => {
      const response = await apiClient.post<ApiResponse<BillDto>>("/bills", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}
