"use client";

import type { ApiResponse, AvailableBusiness, UserDto } from "@bmp/types";
import { useEffect, type PropsWithChildren } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

interface RefreshResponse {
  accessToken: string;
  user: UserDto;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

export function AuthProvider({ children }: PropsWithChildren) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const setInitializing = useAuthStore((state) => state.setInitializing);

  useEffect(() => {
    let cancelled = false;

    async function silentRefresh() {
      try {
        const refreshResponse = await apiClient.post<ApiResponse<RefreshResponse>>(
          "/auth/refresh",
        );
        if (!refreshResponse.data.success) throw new Error("Refresh failed");
        const { accessToken, user, activeBusinessId, availableBusinesses } = refreshResponse.data.data;

        if (!cancelled) {
          setAuth({ accessToken, user, activeBusinessId, availableBusinesses });
        }
      } catch {
        // No valid session — the user will land on the login page.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }

    void silentRefresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children;
}
