import { FILTER_OPERATORS, ITEM_FILTER_FIELDS, ITEM_SORT_FIELDS } from "@bmp/types";
import { z } from "zod";

const filterConditionSchema = z.object({
  columnKey: z.enum(ITEM_FILTER_FIELDS),
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

export const listItemsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(["classified", "unclassified", "unconfirmed", "needs_review"]).optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(ITEM_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListItemsQueryParsed = z.infer<typeof listItemsQuerySchema>;

export const exportItemsQuerySchema = listItemsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportItemsQueryParsed = z.infer<typeof exportItemsQuerySchema>;

export const updateItemCategorySchema = z.object({
  categoryId: z.string().uuid().nullable(),
  confirmed: z.boolean().optional(),
});
export type UpdateItemCategoryBody = z.infer<typeof updateItemCategorySchema>;

// 300-char cap matches deriveCanonicalName — the (businessId, canonicalName) unique btree
// index needs to stay within Postgres' row-size limit.
export const renameItemSchema = z.object({
  canonicalName: z.string().trim().min(1).max(300),
});
export type RenameItemBody = z.infer<typeof renameItemSchema>;

export const classifyBatchSchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type ClassifyBatchQuery = z.infer<typeof classifyBatchSchema>;
