"use client";

import type {
  ApiResponse,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResponseDto,
  ResendVerificationInput,
  ResetPasswordInput,
  SessionDto,
  VerifyEmailInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

export function useLogin() {
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const response = await apiClient.post<ApiResponse<LoginResponseDto>>("/auth/login", input);
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
    onSuccess: (data) => {
      setAuth({
        accessToken: data.accessToken,
        user: data.user,
        activeBusinessId: data.activeBusinessId,
        availableBusinesses: data.availableBusinesses,
      });
    },
  });
}

export function useLogout() {
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post("/auth/logout");
    },
    onSuccess: () => {
      clearAuth();
      queryClient.clear();
      router.push("/login");
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (input: ForgotPasswordInput) => {
      await apiClient.post("/auth/forgot-password", input);
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: ResetPasswordInput) => {
      await apiClient.post("/auth/reset-password", input);
    },
  });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: async (input: VerifyEmailInput) => {
      await apiClient.post("/auth/verify-email", input);
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (input: ResendVerificationInput) => {
      await apiClient.post("/auth/resend-verification", input);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: ChangePasswordInput) => {
      await apiClient.post("/auth/change-password", input);
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SessionDto[]>>("/auth/sessions");
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      await apiClient.delete(`/auth/sessions/${sessionId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
  });
}

export function useLogoutAll() {
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post("/auth/logout-all");
    },
    onSuccess: () => {
      clearAuth();
      router.push("/login");
    },
  });
}
