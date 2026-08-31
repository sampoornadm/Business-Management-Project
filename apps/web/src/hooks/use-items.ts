"use client";

import type {
  ApiResponse,
  ItemDetailDto,
  ItemListEntryDto,
  ListItemsQuery,
  PaginatedResult,
  RenameItemInput,
  UpdateItemCategoryInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useItems(query: ListItemsQuery) {
  return useQuery({
    queryKey: ["items", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<ItemListEntryDto>>>("/items", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: ["items", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ItemDetailDto>>(`/items/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

function invalidateItems(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["items"] });
}

export function useSetItemCategory(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateItemCategoryInput) => {
      const response = await apiClient.patch<ApiResponse<ItemDetailDto>>(`/items/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateItems(queryClient),
  });
}

export function useRenameItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RenameItemInput) => {
      const response = await apiClient.patch<ApiResponse<ItemDetailDto>>(`/items/${id}/name`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateItems(queryClient),
  });
}

export function useClassifyItem(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<ItemDetailDto>>(`/items/${id}/classify`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateItems(queryClient),
  });
}

export function useClassifyItemsBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (limit?: number) => {
      const response = await apiClient.post<
        ApiResponse<{ classified: number; unmatched: number; failed: number; remaining: number }>
      >("/items/classify", null, { params: { limit } });
      return unwrap(response.data);
    },
    onSuccess: () => invalidateItems(queryClient),
  });
}
