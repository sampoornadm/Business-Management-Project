"use client";

import type {
  ApiResponse,
  AssignRoleInput,
  CreateUserInput,
  ListUsersQuery,
  PaginatedResult,
  UpdateOwnProfileInput,
  UpdateUserInput,
  UserDto,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { apiClient } from "@/lib/axios";

export function useUsers(query: ListUsersQuery) {
  return useQuery({
    queryKey: ["users", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<UserDto>>>("/users", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<UserDto>>(`/users/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const response = await apiClient.post<ApiResponse<UserDto>>("/users", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateUser(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      const response = await apiClient.patch<ApiResponse<UserDto>>(`/users/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useAssignRole(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignRoleInput) => {
      const response = await apiClient.patch<ApiResponse<UserDto>>(`/users/${id}/role`, input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useDeactivateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.delete<ApiResponse<UserDto>>(`/users/${id}`);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateOwnProfile() {
  const setUser = useAuthStore((state) => state.setUser);
  return useMutation({
    mutationFn: async (input: UpdateOwnProfileInput) => {
      const response = await apiClient.patch<ApiResponse<UserDto>>("/users/me", input);
      return unwrap(response.data);
    },
    onSuccess: (user) => setUser(user),
  });
}

export function useUploadAvatar() {
  const setUser = useAuthStore((state) => state.setUser);
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);
      const response = await apiClient.post<ApiResponse<UserDto>>("/users/me/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return unwrap(response.data);
    },
    onSuccess: (user) => setUser(user),
  });
}
