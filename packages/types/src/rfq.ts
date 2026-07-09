export const RFQ_STATUSES = ["DRAFT", "SENT", "CLOSED", "AWARDED", "CANCELLED"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_VENDOR_STATUSES = ["INVITED", "RESPONDED", "DECLINED"] as const;
export type RfqVendorStatus = (typeof RFQ_VENDOR_STATUSES)[number];

export interface RfqQuoteDto {
  vendorId: string;
  rate: number;
  remarks: string | null;
  updatedAt: string;
}

export interface RfqItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
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
  sortOrder?: number;
}

export interface CreateRfqInput {
  title: string;
  tenderId?: string;
  dueDate?: string;
  items: CreateRfqItemInput[];
  vendorIds?: string[];
}

export type UpdateRfqInput = Partial<Pick<CreateRfqInput, "title" | "dueDate">>;

export interface AddRfqVendorInput {
  vendorId: string;
}

export interface UpsertRfqQuoteInput {
  rate: number;
  remarks?: string;
}

export interface RfqComparisonQuoteDto {
  vendorId: string;
  vendorName: string;
  rate: number;
  amount: number;
  isLowest: boolean;
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
