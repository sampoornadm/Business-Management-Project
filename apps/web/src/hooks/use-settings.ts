"use client";

import type { ApiResponse, SettingDto, SettingKey } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SettingDto[]>>("/settings");
      return unwrap(response.data);
    },
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: SettingKey; value: string | number | boolean }) => {
      const response = await apiClient.patch<ApiResponse<SettingDto>>(`/settings/${key}`, { value });
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
