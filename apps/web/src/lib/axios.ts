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
//
// A request made with `responseType: "blob"` (file downloads: bills, undertakings, reports)
// gets its error body handed back as a Blob too, even though the server sent JSON — axios
// applies the requested responseType uniformly to error responses, it doesn't sniff the error's
// actual content-type. Left unhandled, every download failure falls through to the generic
// "Request failed with status code N" instead of the real reason. Reading the Blob is async, so
// this becomes async too — the interceptor below is already async for the same reason.
//
// Reads via FileReader rather than the newer Blob.prototype.text(): both work in every real
// browser, but FileReader is also implemented by jsdom (used by this file's own unit tests),
// where Blob.prototype.text is not — using it here keeps the test able to exercise the real
// code path instead of skipping over it.
function readBlobAsText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

export async function extractApiErrorMessage(error: AxiosError): Promise<string> {
  let data = error.response?.data as ApiErrorResponse | Blob | undefined;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    try {
      data = JSON.parse(await readBlobAsText(data)) as ApiErrorResponse;
    } catch {
      return error.message;
    }
  }
  return (data as ApiErrorResponse | undefined)?.error?.message ?? error.message;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    error.message = await extractApiErrorMessage(error);

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
