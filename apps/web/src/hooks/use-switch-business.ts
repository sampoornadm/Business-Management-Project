"use client";

import type { ApiResponse, AvailableBusiness } from "@bmp/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

interface SwitchBusinessResponseDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

export function useSwitchBusiness() {
  const queryClient = useQueryClient();
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: async (businessId: string) => {
      const response = await apiClient.post<ApiResponse<SwitchBusinessResponseDto>>(
        "/auth/switch-business",
        { businessId },
      );
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
    onSuccess: async (data) => {
      setAuth({
        accessToken: data.accessToken,
        activeBusinessId: data.activeBusinessId,
        availableBusinesses: data.availableBusinesses,
      });
      await queryClient.clear();
    },
  });
}
