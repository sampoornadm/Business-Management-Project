"use client";

import type { ApiResponse, AvailableBusiness, LoginResponseDto, UserDto } from "@bmp/types";
import { useEffect, type PropsWithChildren } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

interface RefreshResponse {
  accessToken: string;
  user: UserDto;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

// Dev-only: `pnpm dev:autologin` sets these so a throwaway test instance skips the login page.
// It goes through the real POST /auth/login (no server-side bypass, audit log and RBAC intact),
// and the NODE_ENV check means a production build can never honour it even if the vars leak in.
const AUTO_LOGIN_EMAIL = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_EMAIL;
const AUTO_LOGIN_PASSWORD = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN_PASSWORD;
const AUTO_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" && Boolean(AUTO_LOGIN_EMAIL && AUTO_LOGIN_PASSWORD);

export function AuthProvider({ children }: PropsWithChildren) {
  const setAuth = useAuthStore((state) => state.setAuth);
  const setInitializing = useAuthStore((state) => state.setInitializing);

  async function devAutoLogin() {
    if (!AUTO_LOGIN_ENABLED) return;
    try {
      const response = await apiClient.post<ApiResponse<LoginResponseDto>>("/auth/login", {
        email: AUTO_LOGIN_EMAIL,
        password: AUTO_LOGIN_PASSWORD,
      });
      if (!response.data.success) return;
      const { accessToken, user, activeBusinessId, availableBusinesses } = response.data.data;
      setAuth({ accessToken, user, activeBusinessId, availableBusinesses });
    } catch {
      // Fall through to the normal login page (e.g. API down, rate-limited).
    }
  }

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
        // No valid session — the user will land on the login page, unless this is the dev-only
        // auto-login instance (scripts/dev-autologin.sh), which signs in for real instead.
        await devAutoLogin();
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
