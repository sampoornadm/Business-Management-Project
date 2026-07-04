"use client";

import type {
  ApiResponse,
  CreateBillInput,
  CreateLaborEntryInput,
  CreateMaterialUsageInput,
  CreateMilestoneInput,
  CreateProjectFromTenderInput,
  ListProjectsQuery,
  PaginatedResult,
  ProjectBillDto,
  ProjectCostingDto,
  ProjectDto,
  ProjectLaborEntryDto,
  ProjectListItemDto,
  ProjectMaterialUsageDto,
  ProjectProgressDto,
  UpdateBillStatusInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useProjects(query: ListProjectsQuery) {
  return useQuery({
    queryKey: ["projects", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<ProjectListItemDto>>>(
        "/projects",
        { params: query },
      );
      return unwrap(response.data);
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectDto>>(`/projects/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

function invalidateProject(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  void queryClient.invalidateQueries({ queryKey: ["projects", id] });
}

export function useCreateProjectFromTender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProjectFromTenderInput) => {
      const response = await apiClient.post<ApiResponse<ProjectDto>>("/projects/from-tender", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProjectInput) => {
      const response = await apiClient.patch<ApiResponse<ProjectDto>>(`/projects/${id}`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateProject(queryClient, id),
  });
}

export function useAddMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMilestoneInput) => {
      const response = await apiClient.post<ApiResponse<ProjectDto>>(
        `/projects/${projectId}/milestones`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useUpdateMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ milestoneId, input }: { milestoneId: string; input: UpdateMilestoneInput }) => {
      const response = await apiClient.patch<ApiResponse<ProjectDto>>(
        `/projects/${projectId}/milestones/${milestoneId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      invalidateProject(queryClient, projectId);
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "progress"] });
    },
  });
}

export function useDeleteMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (milestoneId: string) => {
      const response = await apiClient.delete<ApiResponse<ProjectDto>>(
        `/projects/${projectId}/milestones/${milestoneId}`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidateProject(queryClient, projectId),
  });
}

export function useMaterialUsages(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "material-usage"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectMaterialUsageDto[]>>(
        `/projects/${projectId}/material-usage`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

export function useAddMaterialUsage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMaterialUsageInput) => {
      const response = await apiClient.post<ApiResponse<ProjectMaterialUsageDto[]>>(
        `/projects/${projectId}/material-usage`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "material-usage"] });
    },
  });
}

export function useLaborEntries(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "labor-entries"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectLaborEntryDto[]>>(
        `/projects/${projectId}/labor-entries`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

export function useAddLaborEntry(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateLaborEntryInput) => {
      const response = await apiClient.post<ApiResponse<ProjectLaborEntryDto[]>>(
        `/projects/${projectId}/labor-entries`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "labor-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "costing"] });
    },
  });
}

export function useBills(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "bills"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectBillDto[]>>(`/projects/${projectId}/bills`);
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

export function useAddBill(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBillInput) => {
      const response = await apiClient.post<ApiResponse<ProjectBillDto[]>>(
        `/projects/${projectId}/bills`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "bills"] });
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "progress"] });
    },
  });
}

export function useUpdateBillStatus(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ billId, input }: { billId: string; input: UpdateBillStatusInput }) => {
      const response = await apiClient.patch<ApiResponse<ProjectBillDto[]>>(
        `/projects/${projectId}/bills/${billId}/status`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "bills"] });
    },
  });
}

export function useProjectCosting(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "costing"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectCostingDto>>(
        `/projects/${projectId}/costing`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

export function useProjectProgress(projectId: string | undefined) {
  return useQuery({
    queryKey: ["projects", projectId, "progress"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectProgressDto>>(
        `/projects/${projectId}/progress`,
      );
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}
