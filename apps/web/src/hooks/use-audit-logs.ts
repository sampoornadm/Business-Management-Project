"use client";

import type { ApiResponse, AuditLogDto, PaginatedResult } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/axios";

interface AuditLogsQuery {
  page?: number;
  pageSize?: number;
  entityType?: string;
}

export function useAuditLogs(query: AuditLogsQuery, enabled = true) {
  return useQuery({
    queryKey: ["audit-logs", query],
    enabled,
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<AuditLogDto>>>(
        "/audit-logs",
        { params: query },
      );
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
  });
}
