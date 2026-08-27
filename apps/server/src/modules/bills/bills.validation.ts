import { z } from "zod";

const createBillItemSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
});

export const createBillSchema = z.object({
  tenderId: z.string().uuid(),
  grnNumber: z.string().max(100).optional(),
  grnDate: z.string().datetime().or(z.string().date()).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(createBillItemSchema).min(1, "At least one bill item is required"),
});
export type CreateBillBody = z.infer<typeof createBillSchema>;

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});
export type ListBillsQueryParsed = z.infer<typeof listBillsQuerySchema>;
