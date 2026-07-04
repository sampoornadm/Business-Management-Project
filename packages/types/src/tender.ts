export const TENDER_STATUSES = [
  "DRAFT",
  "UPCOMING",
  "DOCUMENT_COLLECTION",
  "UNDER_STUDY",
  "BOQ_PREPARATION",
  "RATE_ANALYSIS",
  "APPROVAL_PENDING",
  "SUBMITTED",
  "TECHNICALLY_QUALIFIED",
  "FINANCIALLY_QUALIFIED",
  "WON",
  "LOST",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  DRAFT: "Draft",
  UPCOMING: "Upcoming",
  DOCUMENT_COLLECTION: "Document Collection",
  UNDER_STUDY: "Under Study",
  BOQ_PREPARATION: "BOQ Preparation",
  RATE_ANALYSIS: "Rate Analysis",
  APPROVAL_PENDING: "Approval Pending",
  SUBMITTED: "Submitted",
  TECHNICALLY_QUALIFIED: "Technically Qualified",
  FINANCIALLY_QUALIFIED: "Financially Qualified",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

/**
 * Legal status transitions. Enforced server-side (source of truth) and used
 * client-side only to disable illegal options in the status-change UI.
 */
export const TENDER_STATUS_TRANSITIONS: Record<TenderStatus, TenderStatus[]> = {
  DRAFT: ["UPCOMING", "CANCELLED"],
  UPCOMING: ["DOCUMENT_COLLECTION", "CANCELLED"],
  DOCUMENT_COLLECTION: ["UNDER_STUDY", "CANCELLED"],
  UNDER_STUDY: ["BOQ_PREPARATION", "CANCELLED"],
  BOQ_PREPARATION: ["RATE_ANALYSIS", "CANCELLED"],
  RATE_ANALYSIS: ["APPROVAL_PENDING", "CANCELLED"],
  APPROVAL_PENDING: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["TECHNICALLY_QUALIFIED", "LOST", "CANCELLED"],
  TECHNICALLY_QUALIFIED: ["FINANCIALLY_QUALIFIED", "LOST"],
  FINANCIALLY_QUALIFIED: ["WON", "LOST"],
  WON: ["ARCHIVED"],
  LOST: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const TENDER_TERMINAL_STATUSES: TenderStatus[] = ["WON", "LOST", "CANCELLED", "ARCHIVED"];

export const TENDER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TenderPriority = (typeof TENDER_PRIORITIES)[number];

export const TENDER_ASSIGNEE_ROLES = ["OWNER", "ESTIMATOR", "REVIEWER", "OTHER"] as const;
export type TenderAssigneeRole = (typeof TENDER_ASSIGNEE_ROLES)[number];

/** Curated suggestions only — the field is free text, not a DB enum. */
export const TENDER_TYPES = ["OPEN", "LIMITED", "SINGLE", "EOI", "RFP", "RFQ"] as const;

/** Curated suggestions only — the field is free text, not a DB enum. */
export const TENDER_CATEGORIES = [
  "CIVIL",
  "ELECTRICAL",
  "MECHANICAL",
  "INFRASTRUCTURE",
  "ROAD",
  "BUILDING",
  "WATER_SUPPLY",
  "OTHER",
] as const;

export const TENDER_DOCUMENT_TYPES = [
  "NIT",
  "BOQ",
  "TECHNICAL_SPECS",
  "DRAWINGS",
  "CORRIGENDUM",
  "TENDER_NOTICE",
  "ADDENDUM",
  "GENERAL",
] as const;
export type TenderDocumentType = (typeof TENDER_DOCUMENT_TYPES)[number];

export interface TenderOrganizationSummaryDto {
  id: string;
  name: string;
  type: "GOVERNMENT" | "PRIVATE";
}

export interface TenderAssigneeDto {
  id: string;
  role: TenderAssigneeRole;
  user: { id: string; firstName: string; lastName: string; email: string };
  assignedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface TenderCompetitorDto {
  id: string;
  competitorName: string;
  bidAmount: number | null;
  isWinningBid: boolean;
  remarks: string | null;
  createdAt: string;
}

export interface TenderTagDto {
  id: string;
  name: string;
  color: string | null;
}

export interface TenderListItemDto {
  id: string;
  tenderNumber: string;
  title: string;
  department: string;
  client: TenderOrganizationSummaryDto;
  type: string;
  category: string;
  status: TenderStatus;
  priority: TenderPriority;
  estimatedCost: number;
  submissionDate: string;
  assigneeCount: number;
  createdAt: string;
}

export interface TenderDto extends TenderListItemDto {
  location: string;
  state: string;
  emdAmount: number | null;
  tenderFee: number | null;
  documentFee: number | null;
  openingDate: string | null;
  validityPeriodDays: number | null;
  statusChangedAt: string;
  description: string | null;
  remarks: string | null;
  winnerName: string | null;
  winningBidAmount: number | null;
  lossReason: string | null;
  createdBy: { id: string; firstName: string; lastName: string };
  assignees: TenderAssigneeDto[];
  competitors: TenderCompetitorDto[];
  tags: TenderTagDto[];
  updatedAt: string;
}

export interface CreateTenderInput {
  tenderNumber: string;
  title: string;
  department: string;
  clientId: string;
  type: string;
  category: string;
  location: string;
  state: string;
  estimatedCost: number;
  emdAmount?: number;
  tenderFee?: number;
  documentFee?: number;
  submissionDate: string;
  openingDate?: string;
  validityPeriodDays?: number;
  priority?: TenderPriority;
  description?: string;
  remarks?: string;
}

export type UpdateTenderInput = Partial<CreateTenderInput>;

export interface ChangeTenderStatusInput {
  status: TenderStatus;
  remarks?: string;
  winnerName?: string;
  winningBidAmount?: number;
  lossReason?: string;
}

export interface AddTenderAssigneeInput {
  userId: string;
  role?: TenderAssigneeRole;
}

export interface CreateTenderCompetitorInput {
  competitorName: string;
  bidAmount?: number;
  isWinningBid?: boolean;
  remarks?: string;
}

export type UpdateTenderCompetitorInput = Partial<CreateTenderCompetitorInput>;

export interface ListTendersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TenderStatus;
  clientId?: string;
  department?: string;
  priority?: TenderPriority;
  assigneeUserId?: string;
  submissionDateFrom?: string;
  submissionDateTo?: string;
}

export interface TenderStatusHistoryEntryDto {
  id: string;
  fromStatus: TenderStatus | null;
  toStatus: TenderStatus;
  remarks: string | null;
  changedBy: { id: string; firstName: string; lastName: string } | null;
  changedAt: string;
}

export interface TenderDashboardStatsDto {
  totalActive: number;
  byStatus: Partial<Record<TenderStatus, number>>;
  pendingApprovalCount: number;
  upcomingDeadlines: TenderListItemDto[];
}
