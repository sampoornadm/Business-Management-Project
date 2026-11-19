"use client";

import type {
  ApiResponse,
  CreateShipmentInput,
  DispatchShipmentInput,
  ProjectSupplyDto,
  ReadableDocumentKind,
  ReadDocumentResultDto,
  RecordShipmentGrnInput,
  RecordShipmentPaymentInput,
  ShipmentDocumentType,
  ShipmentDto,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

const supplyKey = (projectId: string) => ["projects", projectId, "supply"];

export function useProjectSupply(projectId: string | undefined) {
  return useQuery({
    queryKey: supplyKey(projectId ?? ""),
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectSupplyDto>>(`/projects/${projectId}/supply`);
      return unwrap(response.data);
    },
    enabled: Boolean(projectId),
  });
}

function useShipmentMutation<TInput>(projectId: string, run: (input: TInput) => Promise<ShipmentDto | null>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: supplyKey(projectId) }),
  });
}

const post = async <T,>(url: string, body?: unknown) => unwrap((await apiClient.post<ApiResponse<T>>(url, body)).data);

export function useCreateShipment(projectId: string) {
  return useShipmentMutation(projectId, (input: CreateShipmentInput) =>
    post<ShipmentDto>(`/projects/${projectId}/shipments`, input),
  );
}

export function useDispatchShipment(projectId: string) {
  return useShipmentMutation(projectId, ({ id, input }: { id: string; input: DispatchShipmentInput }) =>
    post<ShipmentDto>(`/shipments/${id}/dispatch`, input),
  );
}

export function useRecordShipmentGrn(projectId: string) {
  return useShipmentMutation(projectId, ({ id, input }: { id: string; input: RecordShipmentGrnInput }) =>
    post<ShipmentDto>(`/shipments/${id}/grn`, input),
  );
}

export function useBillShipment(projectId: string) {
  return useShipmentMutation(projectId, (id: string) => post<ShipmentDto>(`/shipments/${id}/bill`));
}

export function useRecordShipmentPayment(projectId: string) {
  return useShipmentMutation(projectId, ({ id, input }: { id: string; input: RecordShipmentPaymentInput }) =>
    post<ShipmentDto>(`/shipments/${id}/payments`, input),
  );
}

export function useUndoShipmentStage(projectId: string) {
  return useShipmentMutation(projectId, (id: string) => post<ShipmentDto>(`/shipments/${id}/undo`));
}

export function useDeleteShipment(projectId: string) {
  return useShipmentMutation(projectId, async (id: string) => {
    await apiClient.delete(`/shipments/${id}`);
    return null;
  });
}

export function useUploadShipmentDocuments(projectId: string) {
  return useShipmentMutation(
    projectId,
    async ({ id, files }: { id: string; files: { file: File; documentType: ShipmentDocumentType }[] }) => {
      let latest: ShipmentDto | null = null;
      for (const { file, documentType } of files) {
        const formData = new FormData();
        formData.append("documentType", documentType);
        formData.append("file", file);
        const response = await apiClient.post<ApiResponse<ShipmentDto>>(`/shipments/${id}/documents`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        latest = unwrap(response.data);
      }
      return latest;
    },
  );
}

/** Reads an e-way bill, GRN or vendor invoice; nothing is saved, so no cache to refresh. */
export function useReadProjectDocument(projectId: string) {
  return useMutation({
    mutationFn: async ({ file, kind }: { file: File; kind?: ReadableDocumentKind }) => {
      const formData = new FormData();
      if (kind) formData.append("kind", kind);
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<ReadDocumentResultDto>>(
        `/projects/${projectId}/documents/read`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
  });
}
