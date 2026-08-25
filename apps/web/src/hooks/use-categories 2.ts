"use client";

import type {
  ApiResponse,
  CategoryLeafDto,
  CategoryNodeDto,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useCategoryTree() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CategoryNodeDto[]>>("/categories");
      return unwrap(response.data);
    },
  });
}

export function useCategoryLeaves() {
  return useQuery({
    queryKey: ["categories", "leaves"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CategoryLeafDto[]>>("/categories/leaves");
      return unwrap(response.data);
    },
  });
}

function invalidateCategories(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["categories"] });
  // Item classification labels depend on the tree, so refresh those too.
  void queryClient.invalidateQueries({ queryKey: ["items"] });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCategoryInput) => {
      const response = await apiClient.post<ApiResponse<CategoryNodeDto[]>>("/categories", input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateCategories(queryClient),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateCategoryInput & { id: string }) => {
      const response = await apiClient.patch<ApiResponse<CategoryNodeDto[]>>(`/categories/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateCategories(queryClient),
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.delete<ApiResponse<CategoryNodeDto[]>>(`/categories/${id}`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateCategories(queryClient),
  });
}
