import type { FilterCondition } from "./filtering.js";

export const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_FILTER_FIELDS = ["name", "status", "budget", "startDate", "endDate"] as const;
export type ProjectFilterField = (typeof PROJECT_FILTER_FIELDS)[number];

export const PROJECT_SORT_FIELDS = [
  "name",
  "status",
  "budget",
  "startDate",
  "endDate",
  "createdAt",
] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export const MILESTONE_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "DELAYED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const LABOR_CATEGORIES = ["SKILLED", "UNSKILLED", "SUPERVISORY"] as const;
export type LaborCategory = (typeof LABOR_CATEGORIES)[number];

export const BILL_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "PAID"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

/** Legal single-path transitions, mirrors TENDER_STATUS_TRANSITIONS. */
export const BILL_STATUS_TRANSITIONS: Record<BillStatus, BillStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED"],
  APPROVED: ["PAID"],
  PAID: [],
};

export interface ProjectMilestoneDto {
  id: string;
  title: string;
  plannedDate: string | null;
  completedDate: string | null;
  status: MilestoneStatus;
  weightPercent: number;
  sortOrder: number;
  createdAt: string;
}

export interface ProjectMaterialUsageDto {
  id: string;
  boqItemId: string | null;
  materialName: string;
  unit: string | null;
  quantityUsed: number;
  usageDate: string;
  remarks: string | null;
  recordedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface ProjectLaborEntryDto {
  id: string;
  category: LaborCategory;
  description: string;
  workerCount: number;
  units: number;
  ratePerUnit: number;
  amount: number;
  entryDate: string;
  remarks: string | null;
  recordedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface ProjectBillDto {
  id: string;
  billNumber: string;
  billDate: string;
  cumulativeAmount: number;
  currentBillAmount: number;
  status: BillStatus;
  remarks: string | null;
  createdBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface ProjectListItemDto {
  id: string;
  tenderId: string;
  name: string;
  status: ProjectStatus;
  budget: number;
  startDate: string;
  endDate: string | null;
  createdAt: string;
}

export interface ProjectDto extends ProjectListItemDto {
  actualEndDate: string | null;
  location: string | null;
  notes: string | null;
  milestones: ProjectMilestoneDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface CreateProjectFromTenderInput {
  tenderId: string;
  name?: string;
  budget?: number;
  startDate: string;
  endDate?: string;
  location?: string;
  notes?: string;
}

export interface UpdateProjectInput {
  name?: string;
  status?: ProjectStatus;
  budget?: number;
  startDate?: string;
  endDate?: string;
  actualEndDate?: string;
  location?: string;
  notes?: string;
}

export interface CreateMilestoneInput {
  title: string;
  plannedDate?: string;
  weightPercent?: number;
  sortOrder?: number;
}

export interface UpdateMilestoneInput {
  title?: string;
  plannedDate?: string;
  completedDate?: string;
  status?: MilestoneStatus;
  weightPercent?: number;
  sortOrder?: number;
}

export interface CreateMaterialUsageInput {
  boqItemId?: string;
  materialName: string;
  unit?: string;
  quantityUsed: number;
  usageDate?: string;
  remarks?: string;
}

export interface CreateLaborEntryInput {
  category: LaborCategory;
  description: string;
  workerCount: number;
  units: number;
  ratePerUnit: number;
  entryDate?: string;
  remarks?: string;
}

export interface CreateProjectBillInput {
  billNumber: string;
  billDate?: string;
  cumulativeAmount: number;
  remarks?: string;
}

export interface UpdateBillStatusInput {
  status: BillStatus;
}

export interface ProjectCostingDto {
  budget: number;
  boqEstimateTotal: number;
  purchaseOrdersTotal: number;
  laborTotal: number;
  totalActualCost: number;
  variance: number;
}

export interface ProjectProgressDto {
  milestoneProgressPercent: number;
  totalMilestones: number;
  completedMilestones: number;
  daysElapsed: number | null;
  daysRemaining: number | null;
  latestBillCumulativeAmount: number;
  budget: number;
}

export interface ListProjectsQuery {
  page?: number;
  pageSize?: number;
  status?: ProjectStatus;
  filters?: FilterCondition[];
  sortBy?: ProjectSortField;
  sortDir?: "asc" | "desc";
}

/** One vendor's reply to one RFQ of the project's tender. */
export interface ProjectRfqVendorSummaryDto {
  vendorId: string;
  vendorName: string;
  status: "INVITED" | "RESPONDED" | "DECLINED";
  quotedItems: number;
  /** Σ RFQ item quantity × quoted rate over the lines this vendor priced. */
  quotedTotal: number;
  /** Lines where this vendor's quote is the selected one. */
  selectedItems: number;
}

export interface ProjectRfqSummaryDto {
  id: string;
  title: string;
  status: "DRAFT" | "SENT" | "CLOSED" | "CANCELLED";
  itemCount: number;
  vendors: ProjectRfqVendorSummaryDto[];
}

export interface ProjectVendorPurchaseOrderSummaryDto {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  status: "DRAFT" | "ISSUED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  totalAmount: number;
  /** Σ received quantity × rate. */
  receivedAmount: number;
  expectedDeliveryDate: string | null;
}

export interface ProjectVendorSummaryDto {
  id: string;
  name: string;
  rfqCount: number;
  purchaseOrderCount: number;
  /** Σ totals of this vendor's non-cancelled POs. */
  purchaseOrderValue: number;
}

/** Everything the project screen shows about the tender it came from and its procurement. */
export interface ProjectOverviewDto {
  tender: {
    id: string;
    tenderNumber: string;
    title: string;
    clientName: string | null;
    evaluationCriteria: string | null;
    winningBidAmount: number | null;
    submissionReference: string | null;
    deliveryPeriodDays: number;
    /** Lines won on an Individual-evaluation tender; 0 = whole tender. */
    wonItemsCount: number;
    wonItemsTotal: number | null;
  };
  rfqs: ProjectRfqSummaryDto[];
  vendors: ProjectVendorSummaryDto[];
  vendorPurchaseOrders: ProjectVendorPurchaseOrderSummaryDto[];
  /** Σ non-cancelled vendor PO totals and Σ of what has been received against them. */
  procurement: { orderedValue: number; receivedValue: number };
}
