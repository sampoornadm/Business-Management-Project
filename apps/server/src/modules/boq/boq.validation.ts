import { z } from "zod";

const commitBoqItemSchema = z.object({
  tempId: z.string().min(1),
  parentTempId: z.string().min(1).optional(),
  itemCode: z.string().max(100).optional(),
  description: z.string().min(1).max(1000),
  category: z.string().max(200).optional(),
  unit: z.string().max(50).optional(),
  quantity: z.number().nonnegative().optional(),
  rate: z.number().nonnegative().optional(),
  remarks: z.string().max(1000).optional(),
  sortOrder: z.number().int().optional(),
});

export const commitBoqSchema = z.object({
  sourceAttachmentId: z.string().uuid().optional(),
  replacesBoqId: z.string().uuid().optional(),
  items: z.array(commitBoqItemSchema).min(1, "At least one BOQ item is required"),
});
export type CommitBoqBody = z.infer<typeof commitBoqSchema>;

export const updateBoqItemSchema = z
  .object({
    itemCode: z.string().max(100).optional(),
    description: z.string().min(1).max(1000).optional(),
    category: z.string().max(200).optional(),
    unit: z.string().max(50).optional(),
    quantity: z.number().nonnegative().optional(),
    rate: z.number().nonnegative().optional(),
    remarks: z.string().max(1000).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });
export type UpdateBoqItemBody = z.infer<typeof updateBoqItemSchema>;

export const bulkUpdateBoqItemsSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
  ratePercentAdjustment: z.number().min(-100).max(1000),
});
export type BulkUpdateBoqItemsBody = z.infer<typeof bulkUpdateBoqItemsSchema>;

export const upsertRateAnalysisSchema = z.object({
  materialCost: z.number().nonnegative(),
  laborCost: z.number().nonnegative(),
  machineryCost: z.number().nonnegative(),
  transportCost: z.number().nonnegative(),
  overheadPercent: z.number().min(0).max(1000),
  profitPercent: z.number().min(0).max(1000),
  taxPercent: z.number().min(0).max(1000),
});
export type UpsertRateAnalysisBody = z.infer<typeof upsertRateAnalysisSchema>;

export const compareBoqQuerySchema = z.object({
  withTenderId: z.string().uuid(),
});
export type CompareBoqQueryParsed = z.infer<typeof compareBoqQuerySchema>;
