"use client";

import type {
  ApiResponse,
  BoqCompareDto,
  BoqDto,
  BoqListItemDto,
  BoqParsePreviewDto,
  BulkUpdateBoqItemsInput,
  CommitBoqInput,
  CreateBoqItemInput,
  UpdateBoqItemInput,
  UpsertBoqItemRateAnalysisInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useCurrentBoq(tenderId: string | undefined) {
  return useQuery({
    queryKey: ["tenders", tenderId, "boq"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BoqDto>>(`/tenders/${tenderId}/boq`);
      return unwrap(response.data);
    },
    enabled: Boolean(tenderId),
    retry: false,
  });
}

export function useBoqVersions(tenderId: string | undefined) {
  return useQuery({
    queryKey: ["tenders", tenderId, "boq", "versions"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BoqListItemDto[]>>(
        `/tenders/${tenderId}/boq/versions`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(tenderId),
  });
}

export function useParseBoqFile(tenderId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<BoqParsePreviewDto>>(
        `/tenders/${tenderId}/boq/parse`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
  });
}

function invalidateBoq(queryClient: ReturnType<typeof useQueryClient>, tenderId: string) {
  void queryClient.invalidateQueries({ queryKey: ["tenders", tenderId, "boq"] });
}

export function useCommitBoq(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CommitBoqInput) => {
      const response = await apiClient.post<ApiResponse<BoqDto>>(`/tenders/${tenderId}/boq`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useFinalizeBoq(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.patch<ApiResponse<BoqDto>>(`/tenders/${tenderId}/boq/finalize`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useAddBoqItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBoqItemInput) => {
      const response = await apiClient.post<ApiResponse<BoqDto>>(`/tenders/${tenderId}/boq/items`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useUpdateBoqItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, input }: { itemId: string; input: UpdateBoqItemInput }) => {
      const response = await apiClient.patch<ApiResponse<BoqDto>>(`/boq-items/${itemId}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useDeleteBoqItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const response = await apiClient.delete<ApiResponse<BoqDto>>(`/boq-items/${itemId}`);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useBulkUpdateBoqItems(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkUpdateBoqItemsInput) => {
      const response = await apiClient.post<ApiResponse<BoqDto>>("/boq-items/bulk-update", input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useUpsertRateAnalysis(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      input,
    }: {
      itemId: string;
      input: UpsertBoqItemRateAnalysisInput;
    }) => {
      const response = await apiClient.put<ApiResponse<BoqDto>>(
        `/boq-items/${itemId}/rate-analysis`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidateBoq(queryClient, tenderId),
  });
}

export function useCompareBoq(tenderId: string | undefined, withTenderId: string | undefined) {
  return useQuery({
    queryKey: ["tenders", tenderId, "boq", "compare", withTenderId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BoqCompareDto>>(
        `/tenders/${tenderId}/boq/compare`,
        { params: { withTenderId } },
      );
      return unwrap(response.data);
    },
    enabled: Boolean(tenderId) && Boolean(withTenderId),
  });
}
