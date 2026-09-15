"use client";

import type { ApiResponse, AuditLogDto, ListAuditLogsQuery, PaginatedResult } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/axios";

export function useAuditLogs(query: ListAuditLogsQuery, enabled = true) {
  return useQuery({
    queryKey: ["audit-logs", query],
    enabled,
    queryFn: async () => {
      // Same axios params-serializer gotcha as use-tenders.ts's useTenders / use-businesses.ts's
      // useBusinesses: `filters` has to be pre-stringified, not left to axios's default
      // bracket-notation array serialization.
      const { filters, ...rest } = query;
      const response = await apiClient.get<ApiResponse<PaginatedResult<AuditLogDto>>>(
        "/audit-logs",
        { params: { ...rest, filters: filters && filters.length > 0 ? JSON.stringify(filters) : undefined } },
      );
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
  });
}
