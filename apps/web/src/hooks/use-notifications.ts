"use client";

import type { ApiResponse, ListNotificationsQuery, NotificationDto, PaginatedResult } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

const NOTIFICATIONS_POLL_INTERVAL_MS = 30_000;

export function useNotifications(query: ListNotificationsQuery = {}) {
  return useQuery({
    queryKey: ["notifications", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<NotificationDto>>>(
        "/notifications",
        { params: query },
      );
      return unwrap(response.data);
    },
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<{ count: number }>>(
        "/notifications/unread-count",
      );
      return unwrap(response.data).count;
    },
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiClient.patch("/notifications/read-all");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
