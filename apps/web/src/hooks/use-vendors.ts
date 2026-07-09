"use client";

import type {
  ApiResponse,
  CreateVendorContactInput,
  CreateVendorInput,
  CreateVendorItemTagInput,
  ImportVendorItemTagsResult,
  ListVendorsQuery,
  PaginatedResult,
  UpdateVendorContactInput,
  UpdateVendorInput,
  VendorDto,
  VendorListItemDto,
  VendorPerformanceDto,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useVendors(query: ListVendorsQuery) {
  return useQuery({
    queryKey: ["vendors", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<VendorListItemDto>>>(
        "/vendors",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function useVendor(id: string | undefined) {
  return useQuery({
    queryKey: ["vendors", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<VendorDto>>(`/vendors/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useVendorPerformance(id: string | undefined) {
  return useQuery({
    queryKey: ["vendors", id, "performance"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<VendorPerformanceDto>>(
        `/vendors/${id}/performance`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateVendorInput) => {
      const response = await apiClient.post<ApiResponse<VendorDto>>("/vendors", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

export function useUpdateVendor(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateVendorInput) => {
      const response = await apiClient.patch<ApiResponse<VendorDto>>(`/vendors/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/vendors/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

export function useAddVendorContact(vendorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateVendorContactInput) => {
      const response = await apiClient.post<ApiResponse<VendorDto>>(
        `/vendors/${vendorId}/contacts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors", vendorId] });
    },
  });
}

export function useUpdateVendorContact(vendorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, input }: { contactId: string; input: UpdateVendorContactInput }) => {
      const response = await apiClient.patch<ApiResponse<VendorDto>>(
        `/vendors/${vendorId}/contacts/${contactId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors", vendorId] });
    },
  });
}

export function useDeleteVendorContact(vendorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiClient.delete<ApiResponse<VendorDto>>(
        `/vendors/${vendorId}/contacts/${contactId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors", vendorId] });
    },
  });
}

export function useAddVendorItemTag(vendorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateVendorItemTagInput) => {
      const response = await apiClient.post<ApiResponse<VendorDto>>(
        `/vendors/${vendorId}/item-tags`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors", vendorId] });
    },
  });
}

export function useDeleteVendorItemTag(vendorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: string) => {
      const response = await apiClient.delete<ApiResponse<VendorDto>>(
        `/vendors/${vendorId}/item-tags/${tagId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors", vendorId] });
    },
  });
}

export function useImportVendorItemTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<ImportVendorItemTagsResult>>(
        "/vendors/item-tags/import",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}
