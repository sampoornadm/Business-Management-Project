"use client";

import type { ApiResponse, AssistantQueryInput, AssistantQueryResultDto } from "@bmp/types";
import { useMutation } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useAssistantQuery() {
  return useMutation({
    mutationFn: async (input: AssistantQueryInput) => {
      const response = await apiClient.post<ApiResponse<AssistantQueryResultDto>>("/assistant/query", input);
      return unwrap(response.data);
    },
  });
}
