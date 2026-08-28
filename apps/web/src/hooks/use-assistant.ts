"use client";

import type { ApiResponse, AssistantQueryResultDto } from "@bmp/types";
import { useMutation } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useAssistantQuery() {
  return useMutation({
    mutationFn: async (message: string) => {
      const response = await apiClient.post<ApiResponse<AssistantQueryResultDto>>("/assistant/query", { message });
      return unwrap(response.data);
    },
  });
}
