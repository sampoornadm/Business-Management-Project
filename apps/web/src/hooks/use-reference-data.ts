"use client";

import type { ApiResponse, ReferenceDataImportDto } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useHsnSacStatus() {
  return useQuery({
    queryKey: ["reference-data", "hsn-sac", "status"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ReferenceDataImportDto | null>>(
        "/reference-data/hsn-sac/status",
      );
      return unwrap(response.data);
    },
  });
}

export function useRefreshHsnSac() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<ReferenceDataImportDto>>(
        "/reference-data/hsn-sac/refresh",
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "hsn-sac", "status"] });
    },
  });
}

export function useUploadHsnSac() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<ReferenceDataImportDto>>(
        "/reference-data/hsn-sac/upload",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "hsn-sac", "status"] });
    },
  });
}
