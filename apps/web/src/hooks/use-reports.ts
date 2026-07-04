"use client";

import type {
  ApiResponse,
  FinancialSummaryReportDto,
  KpiDto,
  ProcurementSpendReportDto,
  ProjectCostingReportDto,
  ReportDateRangeQuery,
  ReportExportFormat,
  ReportKey,
  SearchResultsDto,
  TenderPipelineReportDto,
  VendorPerformanceReportDto,
} from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useTenderPipelineReport() {
  return useQuery({
    queryKey: ["reports", "tender-pipeline"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<TenderPipelineReportDto>>("/reports/tender-pipeline");
      return unwrap(response.data);
    },
  });
}

export function useProcurementSpendReport(range: ReportDateRangeQuery) {
  return useQuery({
    queryKey: ["reports", "procurement-spend", range],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProcurementSpendReportDto>>("/reports/procurement-spend", {
        params: range,
      });
      return unwrap(response.data);
    },
  });
}

export function useProjectCostingReport() {
  return useQuery({
    queryKey: ["reports", "project-costing"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ProjectCostingReportDto>>("/reports/project-costing");
      return unwrap(response.data);
    },
  });
}

export function useFinancialSummaryReport(range: ReportDateRangeQuery) {
  return useQuery({
    queryKey: ["reports", "financial-summary", range],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<FinancialSummaryReportDto>>("/reports/financial-summary", {
        params: range,
      });
      return unwrap(response.data);
    },
  });
}

export function useVendorPerformanceReport() {
  return useQuery({
    queryKey: ["reports", "vendor-performance"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<VendorPerformanceReportDto>>("/reports/vendor-performance");
      return unwrap(response.data);
    },
  });
}

export function useKpis() {
  return useQuery({
    queryKey: ["reports", "kpis"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<KpiDto>>("/reports/kpis");
      return unwrap(response.data);
    },
  });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SearchResultsDto>>("/search", { params: { q: query } });
      return unwrap(response.data);
    },
    enabled: query.trim().length >= 2,
  });
}

export async function downloadReportExport(
  reportKey: ReportKey,
  format: ReportExportFormat,
  range?: ReportDateRangeQuery,
): Promise<void> {
  const response = await apiClient.get<Blob>(`/reports/${reportKey}/export`, {
    params: { format, ...range },
    responseType: "blob",
  });
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reportKey}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
