"use client";

import type { ApiResponse, ClassificationStatusDto } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

const STATUS_KEY = ["classification", "status"];

/**
 * A rebuild trains a model and takes minutes, and there is no push channel here, so the card polls
 * while a run is in flight and stops once it settles.
 */
const POLL_WHILE_RUNNING_MS = 3000;

export function useClassificationStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ClassificationStatusDto>>("/classification/status");
      return unwrap(response.data);
    },
    refetchInterval: (query) => {
      const status = query.state.data?.latestRun?.status;
      return status === "queued" || status === "running" ? POLL_WHILE_RUNNING_MS : false;
    },
  });
}

export function useRebuildClassifier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<{ runId: string }>>("/classification/rebuild");
      return unwrap(response.data);
    },
    onSuccess: () => {
      // Refetch immediately so the card shows "queued" rather than the previous run's result while
      // the first poll is still pending.
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}

export function useCancelRebuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<{ runId: string; trainerStopped: boolean }>>(
        "/classification/rebuild/cancel",
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}
