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
      // setAuth first: resetQueries refetches immediately below, and those requests must
      // carry the NEW business's access token or they'd just re-fetch the old business.
      setAuth({
        accessToken: data.accessToken,
        activeBusinessId: data.activeBusinessId,
        availableBusinesses: data.availableBusinesses,
      });

      // resetQueries, not clear(): clear() empties the cache but never tells mounted
      // observers to refetch, so every already-rendered list/detail kept showing the
      // PREVIOUS business's rows while the switcher claimed you'd moved. Server-side
      // scoping was never the problem — the client just never asked again.
      // reset (not invalidate) so stale cross-business rows are dropped rather than shown
      // while the refetch is in flight.
      await queryClient.resetQueries();
    },
  });
}
