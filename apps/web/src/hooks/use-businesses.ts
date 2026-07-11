"use client";

import type { ApiResponse, PaginatedResult } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export interface Business {
  id: string;
  name: string;
  code: string;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: string | null;
  isActive: boolean;
  tenderCount: number;
}

export interface ListBusinessesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface CreateBusinessInput {
  name: string;
  code: string;
}

export function useBusinesses(query: ListBusinessesQuery) {
  return useQuery({
    queryKey: ["businesses", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<Business>>>("/businesses", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessInput) => {
      const response = await apiClient.post<ApiResponse<Business>>("/businesses", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
    },
  });
}
