import type { FilterCondition } from "./filtering.js";

export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

// totalAmount is deliberately absent here — it's a computed sum of PurchaseOrderItem.amount
// (see purchase-orders.mapper.ts), not a stored column, so Prisma can't filter/sort on it
// server-side (mirrors tenders' assigneeCount exclusion from TENDER_FILTER_FIELDS, though that
// one at least stays sortable via a relation _count; a relation sum has no orderBy equivalent).
export const PURCHASE_ORDER_FILTER_FIELDS = [
  "poNumber",
  "vendorName",
  "status",
  "expectedDeliveryDate",
] as const;
export type PurchaseOrderFilterField = (typeof PURCHASE_ORDER_FILTER_FIELDS)[number];

export const PURCHASE_ORDER_SORT_FIELDS = [
  "poNumber",
  "vendorName",
  "status",
  "expectedDeliveryDate",
  "createdAt",
] as const;
export type PurchaseOrderSortField = (typeof PURCHASE_ORDER_SORT_FIELDS)[number];

export interface PurchaseOrderItemDto {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  amount: number;
  receivedQuantity: number;
  sortOrder: number;
}

export interface GoodsReceiptItemDto {
  id: string;
  purchaseOrderItemId: string;
  quantityReceived: number;
  remarks: string | null;
}

export interface GoodsReceiptDto {
  id: string;
  receivedDate: string;
  remarks: string | null;
  receivedBy: { id: string; firstName: string; lastName: string };
  items: GoodsReceiptItemDto[];
  createdAt: string;
}

export interface VendorRatingSummaryDto {
  id: string;
  rating: number;
  remarks: string | null;
  createdAt: string;
}

export interface PurchaseOrderListItemDto {
  id: string;
  poNumber: string;
  vendor: { id: string; name: string };
  tenderId: string | null;
  status: PurchaseOrderStatus;
  totalAmount: number;
  expectedDeliveryDate: string | null;
  createdAt: string;
}

export interface PurchaseOrderDto extends PurchaseOrderListItemDto {
  sourceRfqId: string | null;
  notes: string | null;
  items: PurchaseOrderItemDto[];
  goodsReceipts: GoodsReceiptDto[];
  vendorRating: VendorRatingSummaryDto | null;
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface CreatePurchaseOrderItemInput {
  description: string;
  unit?: string;
  quantity: number;
  rate: number;
  sortOrder?: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  tenderId?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: CreatePurchaseOrderItemInput[];
}

export interface CreatePurchaseOrderFromRfqInput {
  rfqId: string;
  expectedDeliveryDate?: string;
  notes?: string;
}

export interface UpdatePurchaseOrderStatusInput {
  status: Extract<PurchaseOrderStatus, "ISSUED" | "CANCELLED">;
}

export interface CreateGoodsReceiptItemInput {
  purchaseOrderItemId: string;
  quantityReceived: number;
  remarks?: string;
}

export interface CreateGoodsReceiptInput {
  receivedDate?: string;
  remarks?: string;
  items: CreateGoodsReceiptItemInput[];
}

export interface UpsertVendorRatingInput {
  rating: number;
  remarks?: string;
}

export interface ListPurchaseOrdersQuery {
  page?: number;
  pageSize?: number;
  status?: PurchaseOrderStatus;
  vendorId?: string;
  tenderId?: string;
  filters?: FilterCondition[];
  sortBy?: PurchaseOrderSortField;
  sortDir?: "asc" | "desc";
}
