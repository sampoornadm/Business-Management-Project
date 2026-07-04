export const REPORT_EXPORT_FORMATS = ["xlsx", "pdf"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const REPORT_KEYS = [
  "tender-pipeline",
  "procurement-spend",
  "project-costing",
  "financial-summary",
  "vendor-performance",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportDateRangeQuery {
  from?: string;
  to?: string;
}

export interface TenderPipelineStatusCountDto {
  status: string;
  count: number;
}

export interface TenderPipelineReportDto {
  byStatus: TenderPipelineStatusCountDto[];
  totalTenders: number;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  avgSubmissionDays: number | null;
}

export interface ProcurementSpendByVendorDto {
  vendorId: string;
  vendorName: string;
  total: number;
}

export interface ProcurementSpendByMonthDto {
  month: string;
  total: number;
}

export interface ProcurementSpendReportDto {
  byVendor: ProcurementSpendByVendorDto[];
  byMonth: ProcurementSpendByMonthDto[];
  grandTotal: number;
}

export interface ProjectCostingReportRowDto {
  projectId: string;
  name: string;
  status: string;
  budget: number;
  actualCost: number;
  variance: number;
}

export interface ProjectCostingReportDto {
  projects: ProjectCostingReportRowDto[];
  totalBudget: number;
  totalActualCost: number;
}

export interface FinancialSummaryMonthDto {
  month: string;
  received: number;
  paid: number;
  net: number;
}

export interface FinancialSummaryReportDto {
  months: FinancialSummaryMonthDto[];
}

export interface VendorPerformanceRowDto {
  vendorId: string;
  vendorName: string;
  averageRating: number | null;
  totalRatings: number;
  onTimeDeliveryRate: number | null;
  totalPurchaseOrders: number;
}

export interface VendorPerformanceReportDto {
  vendors: VendorPerformanceRowDto[];
}

export interface KpiDto {
  winRate: number | null;
  avgBoqTurnaroundDays: number | null;
  avgGoodsReceiptLeadDays: number | null;
  receivablesDsoDays: number | null;
}

export const SEARCH_ENTITY_TYPES = ["Tender", "Organization", "Vendor", "Project"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export interface SearchResultItemDto {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchResultsDto {
  query: string;
  results: SearchResultItemDto[];
}
