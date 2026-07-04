"use client";

import type {
  ApiResponse,
  CreateOrganizationContactInput,
  CreateOrganizationInput,
  ListOrganizationsQuery,
  OrganizationDto,
  OrganizationListItemDto,
  PaginatedResult,
  UpdateOrganizationContactInput,
  UpdateOrganizationInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useOrganizations(query: ListOrganizationsQuery) {
  return useQuery({
    queryKey: ["organizations", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<OrganizationListItemDto>>>(
        "/organizations",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: ["organizations", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<OrganizationDto>>(`/organizations/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrganizationInput) => {
      const response = await apiClient.post<ApiResponse<OrganizationDto>>("/organizations", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useUpdateOrganization(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateOrganizationInput) => {
      const response = await apiClient.patch<ApiResponse<OrganizationDto>>(
        `/organizations/${id}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/organizations/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useAddOrganizationContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrganizationContactInput) => {
      const response = await apiClient.post<ApiResponse<OrganizationDto>>(
        `/organizations/${organizationId}/contacts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
    },
  });
}

export function useUpdateOrganizationContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contactId,
      input,
    }: {
      contactId: string;
      input: UpdateOrganizationContactInput;
    }) => {
      const response = await apiClient.patch<ApiResponse<OrganizationDto>>(
        `/organizations/${organizationId}/contacts/${contactId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
    },
  });
}

export function useDeleteOrganizationContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      const response = await apiClient.delete<ApiResponse<OrganizationDto>>(
        `/organizations/${organizationId}/contacts/${contactId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
    },
  });
}
