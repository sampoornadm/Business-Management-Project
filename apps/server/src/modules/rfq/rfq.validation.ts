import { RFQ_STATUSES } from "@bmp/types";
import { z } from "zod";

const createRfqItemSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  sortOrder: z.number().int().optional(),
});

export const createRfqSchema = z.object({
  title: z.string().min(1).max(200),
  tenderId: z.string().uuid().optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  items: z.array(createRfqItemSchema).min(1, "At least one RFQ item is required"),
  vendorIds: z.array(z.string().uuid()).optional(),
});
export type CreateRfqBody = z.infer<typeof createRfqSchema>;

export const updateRfqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
});
export type UpdateRfqBody = z.infer<typeof updateRfqSchema>;

export const listRfqsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(RFQ_STATUSES).optional(),
  tenderId: z.string().uuid().optional(),
});
export type ListRfqsQueryParsed = z.infer<typeof listRfqsQuerySchema>;

export const addRfqVendorSchema = z.object({
  vendorId: z.string().uuid(),
});
export type AddRfqVendorBody = z.infer<typeof addRfqVendorSchema>;

export const upsertRfqQuoteSchema = z.object({
  rate: z.number().nonnegative(),
  remarks: z.string().max(500).optional(),
});
export type UpsertRfqQuoteBody = z.infer<typeof upsertRfqQuoteSchema>;

export const awardRfqSchema = z.object({
  vendorId: z.string().uuid(),
});
export type AwardRfqBody = z.infer<typeof awardRfqSchema>;

export const suggestVendorsSchema = z.object({
  boqItemIds: z.array(z.string().uuid()).min(1, "At least one item is required"),
});
export type SuggestVendorsBody = z.infer<typeof suggestVendorsSchema>;

export const quickSendPreviewSchema = z.object({
  tenderId: z.string().uuid().optional(),
  boqItemIds: z.array(z.string().uuid()).min(1, "At least one item is required"),
  vendorId: z.string().uuid(),
});
export type QuickSendPreviewBody = z.infer<typeof quickSendPreviewSchema>;

export const quickSendSchema = quickSendPreviewSchema.extend({
  text: z.string().min(1, "Text is required"),
});
export type QuickSendBody = z.infer<typeof quickSendSchema>;
