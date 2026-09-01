export const BOQ_STATUSES = ["DRAFT", "FINALIZED"] as const;
export type BoqStatus = (typeof BOQ_STATUSES)[number];

export const HISTORICAL_RATE_CATEGORIES = ["MATERIAL", "LABOR", "MACHINERY", "TRANSPORT"] as const;
export type HistoricalRateCategory = (typeof HISTORICAL_RATE_CATEGORIES)[number];

/**
 * Default Indian GST slab for a BOQ line. Must stay in step with `BoqItem.gstRate`'s
 * `@default(18)` in the Prisma schema, which is the source of truth for stored rows — this
 * copy exists so the UI can reset a cleared field without a round-trip.
 */
export const DEFAULT_GST_RATE = 18;

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
  /** GST percent for this line (default 18). Not included in `amount` — see the BoqItem model. */
  gstRate: number;
  remarks: string | null;
  sortOrder: number;
  rateBreakdown: BoqItemRateBreakdownDto | null;
  /** AI suggestions — all null when enrichment is disabled, pending, or unavailable. */
  normalizedName: string | null;
  aiCategory: string | null;
  aiSubcategory: string | null;
  aiConfidence: number | null;
  suggestedRate: number | null;
  aiSource: string | null;
  aiEnrichedAt: string | null;
  // True once a human has explicitly confirmed the rate-source match (not just applied it once).
  rateSourceConfirmed: boolean;
  children: BoqItemDto[];
}

/** A ranked historical-rate candidate for a BOQ item, computed live (not persisted) so the
 * estimator can see near-misses too, not just the one match that cleared the auto-apply bar. */
export interface BoqRateCandidateDto {
  id: string;
  itemName: string;
  unit: string;
  rate: number;
  similarity: number;
  // Would this be the one auto-applied by enrichment (cosine + spec + unit all agree)?
  isAutoMatch: boolean;
}

/** Confirming can either accept the item's own current AI suggestion (omit override) or pick a
 * different candidate from the possible-matches list (pass its details as override). */
export interface ConfirmBoqRateSourceInput {
  override?: {
    rateSourceId: string;
    itemName: string;
    rate: number;
    confidence: number;
  };
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

export interface CreateBoqItemInput {
  parentId?: string;
  itemCode?: string;
  description: string;
  category?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  gstRate?: number;
  remarks?: string;
}

export interface UpdateBoqItemInput {
  itemCode?: string;
  description?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  gstRate?: number;
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
  vendorId: string | null;
  isDefault: boolean;
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
