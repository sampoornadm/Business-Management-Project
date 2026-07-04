export const PURCHASE_ORDER_STATUSES = [
  "DRAFT",
  "ISSUED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

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
}
