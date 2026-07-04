"use client";

import type { ApiResponse, TenderDashboardStatsDto } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useTenderDashboardStats() {
  return useQuery({
    queryKey: ["tenders", "dashboard-stats"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TenderDashboardStatsDto>>(
        "/tenders/dashboard-stats",
      );
      return unwrap(response.data);
    },
  });
}
