"use client";

import type {
  ApiResponse,
  CompetitorDetailDto,
  CompetitorItemSummaryDto,
  CompetitorListItemDto,
  FetchStatementResultDto,
  ItemComparisonDto,
  TenderRatesToBeatDto,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

/** Firms met as bidders in the client portal's comparative statements. */
export function useCompetitors() {
  return useQuery({
    queryKey: ["competitors", "list"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CompetitorListItemDto[]>>("/competitors");
      return unwrap(response.data);
    },
  });
}

export function useCompetitor(id: string | undefined) {
  return useQuery({
    queryKey: ["competitors", "detail", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CompetitorDetailDto>>(`/competitors/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

/** Marks (or unmarks) a portal vendor as our own firm, so its bids count as "us". */
export function useSetCompetitorSelf(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (isSelf: boolean) => {
      const response = await apiClient.patch<ApiResponse<CompetitorDetailDto>>(`/competitors/${id}`, { isSelf });
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["competitors"] });
    },
  });
}

export function useCompetitorItems(search: string) {
  return useQuery({
    queryKey: ["competitors", "items", search],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<CompetitorItemSummaryDto[]>>("/competitors/items", {
        params: search ? { search } : undefined,
      });
      return unwrap(response.data);
    },
  });
}

/** Every bidder's rate for one item, side by side. */
export function useItemComparison(itemCode: string | undefined) {
  return useQuery({
    queryKey: ["competitors", "item", itemCode],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ItemComparisonDto>>(
        `/competitors/items/${encodeURIComponent(itemCode ?? "")}`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(itemCode),
  });
}

/** Per BOQ item of a tender: likely bidders and the rate to beat. */
export function useRatesToBeat(tenderId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["competitors", "rates-to-beat", tenderId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TenderRatesToBeatDto>>(
        `/competitors/tenders/${tenderId}/rates-to-beat`,
      );
      return unwrap(response.data);
    },
    enabled: enabled && Boolean(tenderId),
  });
}

/** Reads the tender's comparative statement from the portal browser window and saves it. */
export function useFetchComparativeStatement(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<FetchStatementResultDto>>(
        `/competitors/tenders/${tenderId}/fetch-statement`,
        undefined,
        // Opening the portal page and reading a long grid can take a while.
        { timeout: 180_000 },
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["competitors"] });
    },
  });
}
