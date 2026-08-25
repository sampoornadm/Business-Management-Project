import type { ApiErrorResponse, AvailableBusiness } from "@bmp/types";
import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

import { getAccessToken, useAuthStore } from "./auth-store";
import { API_URL } from "./env";

interface RefreshResponseData {
  accessToken: string;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const response = await axios.post<{ data: RefreshResponseData }>(
    `${API_URL}/auth/refresh`,
    {},
    { withCredentials: true },
  );
  const { accessToken, activeBusinessId, availableBusinesses } = response.data.data;
  useAuthStore.getState().setAuth({ accessToken, activeBusinessId, availableBusinesses });
  return accessToken;
}

// axios rejects with a generic "Request failed with status code N" message on any non-2xx
// response — it never looks at the response body. Every error handler in this app that does
// `error instanceof Error ? error.message : ...` depends on this being the server's real
// message (errorHandlerMiddleware always sends { success: false, error: { message } }), so the
// rewrite happens once here rather than in every individual catch block.
export function extractApiErrorMessage(error: AxiosError): string {
  const data = error.response?.data as ApiErrorResponse | undefined;
  return data?.error?.message ?? error.message;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    error.message = extractApiErrorMessage(error);

    const originalRequest = error.config as RetryableConfig | undefined;
    const status = error.response?.status;
    const url = originalRequest?.url ?? "";

    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/refresh");

    if (status === 401 && originalRequest && !originalRequest._retry && !isAuthEndpoint) {
      originalRequest._retry = true;
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const newAccessToken = await refreshPromise;
        originalRequest.headers.set("Authorization", `Bearer ${newAccessToken}`);
        return apiClient(originalRequest);
      } catch {
        useAuthStore.getState().clearAuth();
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
