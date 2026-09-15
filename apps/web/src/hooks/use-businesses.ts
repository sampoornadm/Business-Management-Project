"use client";

import type {
  ApiResponse,
  BusinessDto,
  CreateBusinessContactInput,
  CreateBusinessInput,
  ListBusinessesQuery,
  PaginatedResult,
  UpdateBusinessContactInput,
  UpdateBusinessInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export type { BusinessDto as Business };

export function useBusinesses(query: ListBusinessesQuery) {
  return useQuery({
    queryKey: ["businesses", query],
    queryFn: async () => {
      // axios's default params serializer turns a nested array of objects into
      // filters[0][columnKey]=...&filters[0][operator]=... bracket notation — the backend's
      // listBusinessesQuerySchema expects a single JSON-encoded string instead (it JSON.parses
      // `filters` before validating), so it has to be pre-stringified here rather than left to
      // axios's default serialization. See use-tenders.ts's useTenders for the same gotcha.
      const { filters, ...rest } = query;
      const response = await apiClient.get<ApiResponse<PaginatedResult<BusinessDto>>>(
        "/businesses",
        { params: { ...rest, filters: filters && filters.length > 0 ? JSON.stringify(filters) : undefined } },
      );
      return unwrap(response.data);
    },
  });
}

export function useBusiness(id: string | undefined) {
  return useQuery({
    queryKey: ["businesses", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BusinessDto>>(`/businesses/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessInput) => {
      const response = await apiClient.post<ApiResponse<BusinessDto>>("/businesses", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useUpdateBusiness(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateBusinessInput) => {
      const response = await apiClient.patch<ApiResponse<BusinessDto>>(`/businesses/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useDeleteBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/businesses/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}

export function useAddBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessContactInput) => {
      const response = await apiClient.post<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}

export function useUpdateBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      input,
    }: {
      contactId: string;
      input: UpdateBusinessContactInput;
    }) => {
      const response = await apiClient.patch<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts/${contactId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}

export function useDeleteBusinessContact(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiClient.delete<ApiResponse<BusinessDto>>(
        `/businesses/${businessId}/contacts/${contactId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses", businessId] });
    },
  });
}
