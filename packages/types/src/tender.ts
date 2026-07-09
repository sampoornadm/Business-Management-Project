export const TENDER_STATUSES = ["DRAFT", "SUBMITTED", "WON", "LOST", "CANCELLED"] as const;

export type TenderStatus = (typeof TENDER_STATUSES)[number];

export const TENDER_STATUS_LABELS: Record<TenderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
};

/**
 * Legal status transitions. Enforced server-side (source of truth) and used
 * client-side only to disable illegal options in the status-change UI.
 */
export const TENDER_STATUS_TRANSITIONS: Record<TenderStatus, TenderStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["WON", "LOST", "CANCELLED", "DRAFT"],
  WON: ["SUBMITTED"],
  LOST: ["SUBMITTED"],
  CANCELLED: ["DRAFT", "SUBMITTED"],
};

export const TENDER_TERMINAL_STATUSES: TenderStatus[] = ["WON", "LOST", "CANCELLED"];

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

/**
 * Short, filesystem-friendly subfolder names for the local-docs-sync feature
 * (apps/server/src/modules/tenders/local-docs/). Used both to create the
 * subfolder tree and, reversed case-insensitively, to map a subfolder name
 * back to a documentType when a file is dropped in.
 */
export const TENDER_DOCUMENT_TYPE_FOLDER_NAMES: Record<TenderDocumentType, string> = {
  NIT: "NIT",
  BOQ: "BOQ",
  TECHNICAL_SPECS: "Technical Specs",
  DRAWINGS: "Drawings",
  CORRIGENDUM: "Corrigendum",
  TENDER_NOTICE: "Tender Notice",
  ADDENDUM: "Addendum",
  GENERAL: "General",
};

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
  dealingOfficerName: string | null;
  dealingOfficerEmail: string | null;
  dealingOfficerPhone: string | null;
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
  dealingOfficerName?: string;
  dealingOfficerEmail?: string;
  dealingOfficerPhone?: string;
}

export type UpdateTenderInput = Partial<CreateTenderInput>;

export interface TenderExtractionFields {
  tenderNumber?: string;
  title?: string;
  department?: string;
  type?: string;
  category?: string;
  location?: string;
  state?: string;
  estimatedCost?: number;
  emdAmount?: number;
  tenderFee?: number;
  documentFee?: number;
  submissionDate?: string;
  openingDate?: string;
  validityPeriodDays?: number;
  description?: string;
  remarks?: string;
  dealingOfficerName?: string;
  dealingOfficerEmail?: string;
  dealingOfficerPhone?: string;
}

export interface ExtractedTenderItem {
  itemCode: string;
  description: string;
  quantity?: number;
  unit?: string;
}

export interface TenderExtractionResultDto {
  fields: TenderExtractionFields;
  items: ExtractedTenderItem[];
  suggestedClientId?: string;
  suggestedClientName?: string;
  warnings: string[];
}

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
  upcomingDeadlines: TenderListItemDto[];
}
