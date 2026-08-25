export const RFQ_STATUSES = ["DRAFT", "SENT", "CLOSED", "AWARDED", "CANCELLED"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_VENDOR_STATUSES = ["INVITED", "RESPONDED", "DECLINED"] as const;
export type RfqVendorStatus = (typeof RFQ_VENDOR_STATUSES)[number];

export interface RfqQuoteDto {
  vendorId: string;
  // Null means the vendor gave no price for this line (including a regret) —
  // never coerce to 0, see RfqComparisonQuoteDto below for why.
  rate: number | null;
  regretted: boolean;
  make: string;
  model: string;
  quotedAt: string;
  remarks: string | null;
  updatedAt: string;
}

export interface RfqItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
  sortOrder: number;
  quotes: RfqQuoteDto[];
}

export interface RfqVendorSummaryDto {
  id: string;
  name: string;
}

export interface RfqVendorInviteDto {
  id: string;
  vendor: RfqVendorSummaryDto;
  status: RfqVendorStatus;
  createdAt: string;
}

export interface RfqListItemDto {
  id: string;
  title: string;
  tenderId: string | null;
  status: RfqStatus;
  dueDate: string | null;
  awardedVendorId: string | null;
  itemCount: number;
  vendorCount: number;
  createdAt: string;
}

export interface RfqDto extends RfqListItemDto {
  instructions: string | null;
  items: RfqItemDto[];
  vendorInvites: RfqVendorInviteDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface CreateRfqItemInput {
  boqItemId?: string;
  description: string;
  unit?: string;
  quantity: number;
  instructions?: string;
  sortOrder?: number;
}

export interface CreateRfqInput {
  title: string;
  tenderId?: string;
  dueDate?: string;
  instructions?: string;
  items: CreateRfqItemInput[];
  vendorIds?: string[];
}

export type UpdateRfqInput = Partial<Pick<CreateRfqInput, "title" | "dueDate" | "instructions">>;

export interface AddRfqVendorInput {
  vendorId: string;
}

export interface UpsertRfqQuoteInput {
  // Either a rate or a regret — a regretted line legitimately has no rate.
  rate?: number;
  regretted?: boolean;
  make?: string;
  model?: string;
  quotedAt?: string;
  remarks?: string;
}

export interface RfqComparisonQuoteDto {
  vendorId: string;
  vendorName: string;
  // Null on a regretted (or not-yet-quoted) line — excluded from lowest-rate,
  // totals, and itemsQuoted rather than coerced to 0.
  rate: number | null;
  amount: number | null;
  isLowest: boolean;
  regretted: boolean;
  make: string;
  model: string;
}

export interface RfqComparisonItemDto {
  itemId: string;
  description: string;
  unit: string | null;
  quantity: number;
  quotes: RfqComparisonQuoteDto[];
}

export interface RfqComparisonVendorTotalDto {
  vendorId: string;
  vendorName: string;
  total: number;
  itemsQuoted: number;
}

export interface RfqComparisonDto {
  rfqId: string;
  items: RfqComparisonItemDto[];
  vendorTotals: RfqComparisonVendorTotalDto[];
}

export interface AwardRfqInput {
  vendorId: string;
}

// One historical price observation: a single vendor's quote for one item, across every RFQ.
// Regretted / no-price rows are excluded server-side, so `rate` is always a real number here.
export interface ItemPriceHistoryDto {
  quoteId: string;
  description: string;
  category: string | null;
  unit: string | null;
  quantity: number;
  vendorId: string;
  vendorName: string;
  rate: number;
  make: string;
  model: string;
  quotedAt: string;
  remarks: string | null;
  rfqId: string;
  rfqTitle: string;
  // Null when the quote's RFQ is standalone (not tied to a tender).
  tenderId: string | null;
  tenderName: string | null;
}

// Sortable columns. Category is deliberately absent — it's resolved by a post-query
// lookup (BoqItem), not a column Postgres can ORDER BY.
export const ITEM_PRICE_SORT_FIELDS = [
  "description",
  "unit",
  "quantity",
  "vendorName",
  "rate",
  "make",
  "quotedAt",
  "rfqTitle",
] as const;
export type ItemPriceSortField = (typeof ITEM_PRICE_SORT_FIELDS)[number];

export interface ListItemPricesQuery {
  page?: number;
  pageSize?: number;
  // Matches item description, make, or model.
  search?: string;
  vendorId?: string;
  sortBy?: ItemPriceSortField;
  sortDir?: "asc" | "desc";
}

export interface ListRfqsQuery {
  page?: number;
  pageSize?: number;
  status?: RfqStatus;
  tenderId?: string;
}

export interface SuggestRfqVendorsInput {
  boqItemIds: string[];
}

export interface SuggestedVendorDto {
  vendorId: string;
  name: string;
  itemType: string;
}

export interface RfqVendorSuggestionsPerItemDto {
  boqItemId: string;
  suggestedVendors: SuggestedVendorDto[];
}

export interface RecommendedVendorDto {
  vendorId: string;
  name: string;
  coverageCount: number;
}

export interface RfqVendorSuggestionsDto {
  perItem: RfqVendorSuggestionsPerItemDto[];
  recommended: RecommendedVendorDto[];
}

export interface QuickSendRfqPreviewInput {
  tenderId?: string;
  boqItemIds: string[];
  vendorId: string;
}

export interface QuickSendRfqPreviewDto {
  text: string;
  vendorContactEmail: string;
}

export interface QuickSendRfqInput extends QuickSendRfqPreviewInput {
  text: string;
}
