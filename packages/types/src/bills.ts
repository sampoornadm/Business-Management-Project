import type { FilterCondition } from "./filtering.js";

export const BILL_FILTER_FIELDS = ["billNumber", "tenderTitle", "clientName", "billDate"] as const;
export type BillFilterField = (typeof BILL_FILTER_FIELDS)[number];

// itemCount is sortable (Prisma can orderBy a relation's _count) but not filterable — see
// bills.filter-columns.ts's comment. `total` is neither: it's a computed sum (quantity × rate
// across BillItem rows), not a column or an aggregate Prisma can order/filter by.
export const BILL_SORT_FIELDS = [
  "billNumber",
  "tenderTitle",
  "clientName",
  "billDate",
  "itemCount",
  "createdAt",
] as const;
export type BillSortField = (typeof BILL_SORT_FIELDS)[number];

export interface CreateBillItemInput {
  boqItemId?: string;
  description: string;
  unit?: string;
  quantity: number;
  rate: number;
}

export interface CreateBillInput {
  tenderId: string;
  grnNumber?: string;
  grnDate?: string;
  items: CreateBillItemInput[];
}

export interface BillItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder: number;
}

export interface BillListItemDto {
  id: string;
  billNumber: string;
  billDate: string;
  tenderId: string;
  tenderTitle: string;
  clientName: string;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface BillDto extends BillListItemDto {
  grnNumber: string | null;
  grnDate: string | null;
  items: BillItemDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface ListBillsQuery {
  page?: number;
  pageSize?: number;
  tenderId?: string;
  filters?: FilterCondition[];
  sortBy?: BillSortField;
  sortDir?: "asc" | "desc";
}
