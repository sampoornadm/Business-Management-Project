import { PURCHASE_ORDER_STATUSES } from "@bmp/types";
import { z } from "zod";

const createPurchaseOrderItemSchema = z.object({
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
  sortOrder: z.number().int().optional(),
});

export const createPurchaseOrderSchema = z.object({
  vendorId: z.string().uuid(),
  tenderId: z.string().uuid().optional(),
  expectedDeliveryDate: z.string().datetime().or(z.string().date()).optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(createPurchaseOrderItemSchema).min(1, "At least one item is required"),
});
export type CreatePurchaseOrderBody = z.infer<typeof createPurchaseOrderSchema>;

export const createPurchaseOrderFromRfqSchema = z.object({
  rfqId: z.string().uuid(),
  expectedDeliveryDate: z.string().datetime().or(z.string().date()).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreatePurchaseOrderFromRfqBody = z.infer<typeof createPurchaseOrderFromRfqSchema>;

export const updatePurchaseOrderStatusSchema = z.object({
  status: z.enum(["ISSUED", "CANCELLED"]),
});
export type UpdatePurchaseOrderStatusBody = z.infer<typeof updatePurchaseOrderStatusSchema>;

const createGoodsReceiptItemSchema = z.object({
  purchaseOrderItemId: z.string().uuid(),
  quantityReceived: z.number().positive(),
  remarks: z.string().max(500).optional(),
});

export const createGoodsReceiptSchema = z.object({
  receivedDate: z.string().datetime().or(z.string().date()).optional(),
  remarks: z.string().max(2000).optional(),
  items: z.array(createGoodsReceiptItemSchema).min(1, "At least one received item is required"),
});
export type CreateGoodsReceiptBody = z.infer<typeof createGoodsReceiptSchema>;

export const upsertVendorRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  remarks: z.string().max(1000).optional(),
});
export type UpsertVendorRatingBody = z.infer<typeof upsertVendorRatingSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  vendorId: z.string().uuid().optional(),
  tenderId: z.string().uuid().optional(),
});
export type ListPurchaseOrdersQueryParsed = z.infer<typeof listPurchaseOrdersQuerySchema>;
