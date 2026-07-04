export const BOQ_STATUSES = ["DRAFT", "FINALIZED"] as const;
export type BoqStatus = (typeof BOQ_STATUSES)[number];

export const HISTORICAL_RATE_CATEGORIES = ["MATERIAL", "LABOR", "MACHINERY", "TRANSPORT"] as const;
export type HistoricalRateCategory = (typeof HISTORICAL_RATE_CATEGORIES)[number];

/** Curated suggestions only — the field is free text, not a DB enum. */
export const BOQ_COLUMN_FIELDS = [
  "itemCode",
  "description",
  "category",
  "unit",
  "quantity",
  "rate",
] as const;
export type BoqColumnField = (typeof BOQ_COLUMN_FIELDS)[number];

export interface BoqItemRateBreakdownDto {
  materialCost: number;
  laborCost: number;
  machineryCost: number;
  transportCost: number;
  overheadPercent: number;
  profitPercent: number;
  taxPercent: number;
  computedRate: number;
  updatedAt: string;
}

export interface BoqItemDto {
  id: string;
  parentId: string | null;
  itemCode: string | null;
  description: string;
  category: string | null;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  remarks: string | null;
  sortOrder: number;
  rateBreakdown: BoqItemRateBreakdownDto | null;
  children: BoqItemDto[];
}

export interface BoqDto {
  id: string;
  tenderId: string;
  sourceAttachmentId: string | null;
  groupId: string;
  version: number;
  isCurrent: boolean;
  status: BoqStatus;
  createdBy: { id: string; firstName: string; lastName: string };
  items: BoqItemDto[];
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoqListItemDto {
  id: string;
  groupId: string;
  version: number;
  isCurrent: boolean;
  status: BoqStatus;
  totalAmount: number;
  createdBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

/** A single row as parsed from the uploaded file, before column mapping is confirmed. */
export interface BoqParsePreviewRow {
  rowIndex: number;
  cells: Record<string, string | number | null>;
}

export interface BoqParsePreviewDto {
  sourceAttachmentId: string;
  columns: string[];
  /** Best-guess header -> field mapping, always user-confirmable before commit. */
  suggestedMapping: Partial<Record<BoqColumnField, string>>;
  rows: BoqParsePreviewRow[];
}

export interface CommitBoqItemInput {
  tempId: string;
  parentTempId?: string;
  itemCode?: string;
  description: string;
  category?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  remarks?: string;
  sortOrder?: number;
}

export interface CommitBoqInput {
  sourceAttachmentId?: string;
  replacesBoqId?: string;
  items: CommitBoqItemInput[];
}

export interface UpdateBoqItemInput {
  itemCode?: string;
  description?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  remarks?: string;
  sortOrder?: number;
}

export interface BulkUpdateBoqItemsInput {
  itemIds: string[];
  /** Percentage adjustment applied to each selected item's rate, e.g. 5 = +5%, -10 = -10%. */
  ratePercentAdjustment: number;
}

export interface UpsertBoqItemRateAnalysisInput {
  materialCost: number;
  laborCost: number;
  machineryCost: number;
  transportCost: number;
  overheadPercent: number;
  profitPercent: number;
  taxPercent: number;
}

export interface BoqCompareLineDto {
  description: string;
  category: string | null;
  unit: string | null;
  baseQuantity: number | null;
  baseRate: number | null;
  baseAmount: number | null;
  compareQuantity: number | null;
  compareRate: number | null;
  compareAmount: number | null;
  rateDelta: number | null;
  amountDelta: number | null;
}

export interface BoqCompareDto {
  baseTenderId: string;
  compareTenderId: string;
  lines: BoqCompareLineDto[];
  baseTotalAmount: number;
  compareTotalAmount: number;
}

export interface HistoricalRateDto {
  id: string;
  category: HistoricalRateCategory;
  itemName: string;
  unit: string;
  rate: number;
  location: string | null;
  effectiveDate: string;
  sourceTenderId: string | null;
  notes: string | null;
  createdBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface CreateHistoricalRateInput {
  category: HistoricalRateCategory;
  itemName: string;
  unit: string;
  rate: number;
  location?: string;
  effectiveDate: string;
  sourceTenderId?: string;
  notes?: string;
}

export interface SuggestHistoricalRatesQuery {
  category: HistoricalRateCategory;
  itemName: string;
  limit?: number;
}
