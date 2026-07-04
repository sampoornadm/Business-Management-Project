"use client";

import type { ApiResponse, RoleWithPermissionsDto } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/axios";

export function useRoles() {
  return useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<RoleWithPermissionsDto[]>>("/roles");
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
  });
}
