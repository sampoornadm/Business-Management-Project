import { ITEM_PRICE_SORT_FIELDS, RFQ_STATUSES } from "@bmp/types";
import { z } from "zod";

const createRfqItemSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  instructions: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
});

export const createRfqSchema = z.object({
  title: z.string().min(1).max(200),
  tenderId: z.string().uuid().optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  instructions: z.string().max(2000).optional(),
  items: z.array(createRfqItemSchema).min(1, "At least one RFQ item is required"),
  vendorIds: z.array(z.string().uuid()).optional(),
});
export type CreateRfqBody = z.infer<typeof createRfqSchema>;

export const updateRfqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  instructions: z.string().max(2000).optional(),
});
export type UpdateRfqBody = z.infer<typeof updateRfqSchema>;

export const listRfqsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(RFQ_STATUSES).optional(),
  tenderId: z.string().uuid().optional(),
});
export type ListRfqsQueryParsed = z.infer<typeof listRfqsQuerySchema>;

export const listItemPricesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  vendorId: z.string().uuid().optional(),
  sortBy: z.enum(ITEM_PRICE_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListItemPricesQueryParsed = z.infer<typeof listItemPricesQuerySchema>;

export const addRfqVendorSchema = z.object({
  vendorId: z.string().uuid(),
});
export type AddRfqVendorBody = z.infer<typeof addRfqVendorSchema>;

export const upsertRfqQuoteSchema = z
  .object({
    // Either a rate or a regret. Enforced by the refine below rather than by making rate
    // required, because a regret legitimately has no rate.
    rate: z.number().nonnegative().optional(),
    regretted: z.boolean().optional(),
    make: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    quotedAt: z.coerce.date().optional(),
    remarks: z.string().max(500).optional(),
  })
  .refine((d) => d.regretted === true || d.rate !== undefined, {
    message: "Provide a rate, or mark the item as regretted",
  });
export type UpsertRfqQuoteBody = z.infer<typeof upsertRfqQuoteSchema>;

export const selectQuoteSchema = z.object({
  quoteId: z.string().uuid(),
});
export type SelectQuoteBody = z.infer<typeof selectQuoteSchema>;

export const importQuotesSchema = z.object({
  vendorId: z.string().uuid(),
});
export type ImportQuotesBody = z.infer<typeof importQuotesSchema>;

export const suggestVendorsSchema = z.object({
  boqItemIds: z.array(z.string().uuid()).min(1, "At least one item is required"),
});
export type SuggestVendorsBody = z.infer<typeof suggestVendorsSchema>;

export const inviteVendorPreviewSchema = z.object({
  vendorId: z.string().uuid(),
});
export type InviteVendorPreviewBody = z.infer<typeof inviteVendorPreviewSchema>;

export const inviteVendorSchema = inviteVendorPreviewSchema.extend({
  text: z.string().min(1, "Text is required"),
});
export type InviteVendorBody = z.infer<typeof inviteVendorSchema>;
