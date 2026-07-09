"use client";

import type {
  ApiResponse,
  AwardRfqInput,
  CreateRfqInput,
  ListRfqsQuery,
  PaginatedResult,
  QuickSendRfqInput,
  QuickSendRfqPreviewDto,
  QuickSendRfqPreviewInput,
  RfqComparisonDto,
  RfqDto,
  RfqListItemDto,
  RfqVendorSuggestionsDto,
  SuggestRfqVendorsInput,
  UpdateRfqInput,
  UpsertRfqQuoteInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useRfqs(query: ListRfqsQuery) {
  return useQuery({
    queryKey: ["rfqs", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<RfqListItemDto>>>("/rfqs", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useRfq(id: string | undefined) {
  return useQuery({
    queryKey: ["rfqs", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<RfqDto>>(`/rfqs/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

function invalidateRfq(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["rfqs", id] });
}

export function useSuggestRfqVendors() {
  return useMutation({
    mutationFn: async (input: SuggestRfqVendorsInput) => {
      const response = await apiClient.post<ApiResponse<RfqVendorSuggestionsDto>>(
        "/rfqs/suggest-vendors",
        input,
      );
      return unwrap(response.data);
    },
  });
}

export function usePreviewQuickSendRfq() {
  return useMutation({
    mutationFn: async (input: QuickSendRfqPreviewInput) => {
      const response = await apiClient.post<ApiResponse<QuickSendRfqPreviewDto>>(
        "/rfqs/quick-send/preview",
        input,
      );
      return unwrap(response.data);
    },
  });
}

export function useQuickSendRfq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: QuickSendRfqInput) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>("/rfqs/quick-send", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rfqs"] });
    },
  });
}

export function useCreateRfq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateRfqInput) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>("/rfqs", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rfqs"] });
    },
  });
}

export function useUpdateRfq(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateRfqInput) => {
      const response = await apiClient.patch<ApiResponse<RfqDto>>(`/rfqs/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}

export function useAddRfqVendor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vendorId: string) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(`/rfqs/${id}/vendors`, { vendorId });
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}

export function useRemoveRfqVendor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vendorId: string) => {
      const response = await apiClient.delete<ApiResponse<RfqDto>>(`/rfqs/${id}/vendors/${vendorId}`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}

export function useUpsertRfqQuote(rfqId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      vendorId,
      input,
    }: {
      itemId: string;
      vendorId: string;
      input: UpsertRfqQuoteInput;
    }) => {
      const response = await apiClient.put<ApiResponse<RfqDto>>(
        `/rfq-items/${itemId}/quotes/${vendorId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      invalidateRfq(queryClient, rfqId);
      void queryClient.invalidateQueries({ queryKey: ["rfqs", rfqId, "comparison"] });
    },
  });
}

export function useRfqComparison(id: string | undefined) {
  return useQuery({
    queryKey: ["rfqs", id, "comparison"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<RfqComparisonDto>>(`/rfqs/${id}/comparison`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useAwardRfq(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AwardRfqInput) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(`/rfqs/${id}/award`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}

export function useCloseRfq(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(`/rfqs/${id}/close`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}

export function useReopenRfq(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(`/rfqs/${id}/reopen`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, id),
  });
}
