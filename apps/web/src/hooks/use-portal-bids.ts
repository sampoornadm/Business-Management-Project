"use client";

import type {
  ApiResponse,
  PortalFillJobDto,
  PortalProfileDto,
  UpdatePortalProfileInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

const POLL_MS = 500;

/** The current business's SAIL ISP answer sheet. */
export function usePortalProfile(enabled = true) {
  return useQuery({
    queryKey: ["portal-profile"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PortalProfileDto>>("/portal-bids/profile");
      return unwrap(response.data);
    },
    enabled,
  });
}

export function useUpdatePortalProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePortalProfileInput) => {
      const response = await apiClient.put<ApiResponse<PortalProfileDto>>("/portal-bids/profile", input);
      return unwrap(response.data);
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(["portal-profile"], profile);
    },
  });
}

export function useStartPortalFill() {
  return useMutation({
    mutationFn: async (tenderId: string) => {
      const response = await apiClient.post<ApiResponse<PortalFillJobDto>>(
        `/portal-bids/tenders/${tenderId}/fill`,
      );
      return unwrap(response.data);
    },
  });
}

/** Polls a fill job until it is no longer running. */
export function usePortalFillJob(jobId: string | null) {
  return useQuery({
    queryKey: ["portal-fill-job", jobId],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PortalFillJobDto>>(`/portal-bids/fill-jobs/${jobId}`);
      return unwrap(response.data);
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? POLL_MS : false),
  });
}
