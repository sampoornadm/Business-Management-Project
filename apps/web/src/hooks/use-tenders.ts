"use client";

import type {
  AddTenderAssigneeInput,
  ApiResponse,
  AttachmentDto,
  ChangeTenderStatusInput,
  CreateTenderCompetitorInput,
  CreateTenderInput,
  ListTendersQuery,
  PaginatedResult,
  TenderDto,
  TenderListItemDto,
  TenderStatusHistoryEntryDto,
  UpdateTenderCompetitorInput,
  UpdateTenderInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useTenders(query: ListTendersQuery) {
  return useQuery({
    queryKey: ["tenders", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<TenderListItemDto>>>(
        "/tenders",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function useTender(id: string | undefined) {
  return useQuery({
    queryKey: ["tenders", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TenderDto>>(`/tenders/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTenderInput) => {
      const response = await apiClient.post<ApiResponse<TenderDto>>("/tenders", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders"] });
    },
  });
}

export function useUpdateTender(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTenderInput) => {
      const response = await apiClient.patch<ApiResponse<TenderDto>>(`/tenders/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders"] });
    },
  });
}

export function useDeleteTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/tenders/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders"] });
    },
  });
}

export function useChangeTenderStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChangeTenderStatusInput) => {
      const response = await apiClient.patch<ApiResponse<TenderDto>>(`/tenders/${id}/status`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders"] });
      void queryClient.invalidateQueries({ queryKey: ["tenders", id, "status-history"] });
    },
  });
}

export function useTenderStatusHistory(id: string | undefined, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ["tenders", id, "status-history", page, pageSize],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<TenderStatusHistoryEntryDto>>>(
        `/tenders/${id}/status-history`,
        { params: { page, pageSize } },
      );
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useAddTenderAssignee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddTenderAssigneeInput) => {
      const response = await apiClient.post<ApiResponse<TenderDto>>(`/tenders/${id}/assignees`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useRemoveTenderAssignee(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiClient.delete<ApiResponse<TenderDto>>(
        `/tenders/${id}/assignees/${userId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useAddTenderCompetitor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTenderCompetitorInput) => {
      const response = await apiClient.post<ApiResponse<TenderDto>>(`/tenders/${id}/competitors`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useUpdateTenderCompetitor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      competitorId,
      input,
    }: {
      competitorId: string;
      input: UpdateTenderCompetitorInput;
    }) => {
      const response = await apiClient.patch<ApiResponse<TenderDto>>(
        `/tenders/${id}/competitors/${competitorId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useDeleteTenderCompetitor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (competitorId: string) => {
      const response = await apiClient.delete<ApiResponse<TenderDto>>(
        `/tenders/${id}/competitors/${competitorId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useSetTenderTags(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagIds: string[]) => {
      const response = await apiClient.put<ApiResponse<TenderDto>>(`/tenders/${id}/tags`, { tagIds });
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
    },
  });
}

export function useTenderDocuments(id: string | undefined, documentType?: string) {
  return useQuery({
    queryKey: ["tenders", id, "documents", documentType],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<AttachmentDto[]>>(`/tenders/${id}/documents`, {
        params: documentType ? { documentType } : undefined,
      });
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useUploadTenderDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      documentType,
      replacesAttachmentId,
    }: {
      file: File;
      documentType: string;
      replacesAttachmentId?: string;
    }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("documentType", documentType);
      if (replacesAttachmentId) formData.append("replacesAttachmentId", replacesAttachmentId);
      const response = await apiClient.post<ApiResponse<AttachmentDto>>(
        `/tenders/${id}/documents`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tenders", id, "documents"] });
    },
  });
}

export function useTenderDocumentVersions(id: string | undefined, documentGroupId: string | undefined) {
  return useQuery({
    queryKey: ["tenders", id, "documents", "versions", documentGroupId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<AttachmentDto[]>>(
        `/tenders/${id}/documents/${documentGroupId}/versions`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(id) && Boolean(documentGroupId),
  });
}
