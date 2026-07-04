"use client";

import type {
  ApiResponse,
  CreateHistoricalRateInput,
  HistoricalRateCategory,
  HistoricalRateDto,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useHistoricalRates(filters: { category?: HistoricalRateCategory; itemName?: string }) {
  return useQuery({
    queryKey: ["rates", filters],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<HistoricalRateDto[]>>("/rates", {
        params: filters,
      });
      return unwrap(response.data);
    },
  });
}

export function useSuggestRates(category: HistoricalRateCategory | undefined, itemName: string) {
  return useQuery({
    queryKey: ["rates", "suggest", category, itemName],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<HistoricalRateDto[]>>("/rates/suggest", {
        params: { category, itemName, limit: 5 },
      });
      return unwrap(response.data);
    },
    enabled: Boolean(category) && itemName.trim().length > 1,
  });
}

export function useCreateHistoricalRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateHistoricalRateInput) => {
      const response = await apiClient.post<ApiResponse<HistoricalRateDto>>("/rates", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rates"] });
    },
  });
}
