"use client";

import type { ApiResponse, CreateTagInput, TagDto } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TagDto[]>>("/tags");
      return unwrap(response.data);
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTagInput) => {
      const response = await apiClient.post<ApiResponse<TagDto>>("/tags", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}
