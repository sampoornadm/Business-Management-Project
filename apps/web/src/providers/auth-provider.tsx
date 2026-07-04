"use client";

import type { ApiResponse, UserDto } from "@bmp/types";
import { useEffect, type PropsWithChildren } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

export function AuthProvider({ children }: PropsWithChildren) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const setInitializing = useAuthStore((state) => state.setInitializing);

  useEffect(() => {
    let cancelled = false;

    async function silentRefresh() {
      try {
        const refreshResponse = await apiClient.post<ApiResponse<{ accessToken: string }>>(
          "/auth/refresh",
        );
        if (!refreshResponse.data.success) throw new Error("Refresh failed");
        const { accessToken } = refreshResponse.data.data;

        const meResponse = await apiClient.get<ApiResponse<UserDto>>("/users/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!meResponse.data.success) throw new Error("Failed to load current user");

        if (!cancelled) {
          setAuth({ accessToken, user: meResponse.data.data });
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
