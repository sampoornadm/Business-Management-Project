import { ITEM_SORT_FIELDS } from "@bmp/types";
import { z } from "zod";

export const listItemsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  status: z.enum(["classified", "unclassified", "unconfirmed"]).optional(),
  sortBy: z.enum(ITEM_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListItemsQueryParsed = z.infer<typeof listItemsQuerySchema>;

export const updateItemCategorySchema = z.object({
  categoryId: z.string().uuid().nullable(),
  confirmed: z.boolean().optional(),
});
export type UpdateItemCategoryBody = z.infer<typeof updateItemCategorySchema>;

export const classifyBatchSchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type ClassifyBatchQuery = z.infer<typeof classifyBatchSchema>;
