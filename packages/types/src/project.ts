export const PROJECT_STATUSES = ["ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

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

export interface CreateBillInput {
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
}
