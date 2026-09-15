import { BILL_FILTER_FIELDS, BILL_SORT_FIELDS, FILTER_OPERATORS } from "@bmp/types";
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
  items: z.array(createBillItemSchema).min(1, "At least one bill item is required"),
});
export type CreateBillBody = z.infer<typeof createBillSchema>;

const filterConditionSchema = z.object({
  columnKey: z.enum(BILL_FILTER_FIELDS),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

const filtersQueryParam = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(filterConditionSchema).optional());

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  tenderId: z.string().uuid().optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(BILL_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListBillsQueryParsed = z.infer<typeof listBillsQuerySchema>;

export const exportBillsQuerySchema = listBillsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportBillsQueryParsed = z.infer<typeof exportBillsQuerySchema>;
