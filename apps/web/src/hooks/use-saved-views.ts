"use client";

import type { ApiResponse, CreateSavedViewInput, SavedViewDto, UpdateSavedViewInput } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useSavedViews(pageKey: string) {
  return useQuery({
    queryKey: ["saved-views", pageKey],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SavedViewDto[]>>("/saved-views", {
        params: { pageKey },
      });
      return unwrap(response.data);
    },
  });
}

export function useCreateSavedView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSavedViewInput) => {
      const response = await apiClient.post<ApiResponse<SavedViewDto>>("/saved-views", input);
      return unwrap(response.data);
    },
    onSuccess: (view) => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", view.pageKey] });
    },
  });
}

export function useUpdateSavedView(pageKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateSavedViewInput }) => {
      const response = await apiClient.patch<ApiResponse<SavedViewDto>>(`/saved-views/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", pageKey] });
    },
  });
}

export function useDeleteSavedView(pageKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/saved-views/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["saved-views", pageKey] });
    },
  });
}
