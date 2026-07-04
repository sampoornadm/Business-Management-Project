"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/axios";

interface HealthChecks {
  postgres: boolean;
  redis: boolean;
  s3: boolean;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: HealthChecks }>("/health", {
        validateStatus: () => true,
      });
      return response.data.data;
    },
    refetchInterval: 30_000,
  });
}
