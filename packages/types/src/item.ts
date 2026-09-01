import type { ItemPriceHistoryDto } from "./rfq.js";

// A resolved item's current classification. categoryId set + confirmed:false is an AI guess
// awaiting review; confirmed:true is human-approved; categoryId null is unclassified.
export interface ItemClassificationDto {
  categoryId: string | null;
  categoryPath: string | null; // "Electrical > Cable"
  confirmed: boolean;
  aiConfidence: number | null;
  // True when the LLM classify path reported high confidence but the nearest known item was a
  // weak semantic match — flags this suggestion as worth a closer look, distinct from an
  // ordinary unconfirmed AI guess with decent grounding.
  needsReview: boolean;
}

export interface ItemListEntryDto extends ItemClassificationDto {
  id: string;
  canonicalName: string;
  unit: string | null;
  quoteCount: number;
  vendorCount: number;
  minRate: number | null;
  maxRate: number | null;
  avgRate: number | null;
  lastQuotedAt: string | null;
}

export interface ItemDetailDto extends ItemClassificationDto {
  id: string;
  canonicalName: string;
  unit: string | null;
  // Every historical quote that resolved to this item (tender, vendor, rate, make, date).
  entries: ItemPriceHistoryDto[];
}

export const ITEM_SORT_FIELDS = [
  "canonicalName",
  "categoryPath",
  "quoteCount",
  "minRate",
  "maxRate",
  "avgRate",
  "lastQuotedAt",
] as const;
export type ItemSortField = (typeof ITEM_SORT_FIELDS)[number];

export interface ListItemsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  // "classified" | "unclassified" | "unconfirmed" | "needs_review" — filter by classification state.
  status?: "classified" | "unclassified" | "unconfirmed" | "needs_review";
  sortBy?: ItemSortField;
  sortDir?: "asc" | "desc";
}

// Confirm or override an item's category. categoryId null clears it; confirmed defaults true
// (a human touched it).
export interface UpdateItemCategoryInput {
  categoryId: string | null;
  confirmed?: boolean;
}

// Rename the item's canonical name — the one place that controls the concise/refined name
// used everywhere downstream (RFQ vendor-facing text, rate matching, price history grouping).
export interface RenameItemInput {
  canonicalName: string;
}
