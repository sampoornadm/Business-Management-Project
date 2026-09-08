import { FILTER_OPERATORS } from "@bmp/types";
import { z } from "zod";

const filterConditionSchema = z.object({
  columnKey: z.string().min(1),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
});

export const listSavedViewsQuerySchema = z.object({
  pageKey: z.string().min(1),
});
export type ListSavedViewsQueryParsed = z.infer<typeof listSavedViewsQuerySchema>;

export const createSavedViewSchema = z.object({
  pageKey: z.string().min(1),
  name: z.string().min(1).max(100),
  filters: z.array(filterConditionSchema),
  visibleColumns: z.array(z.string()),
  columnOrder: z.array(z.string()),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type CreateSavedViewBody = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = createSavedViewSchema.omit({ pageKey: true }).partial();
export type UpdateSavedViewBody = z.infer<typeof updateSavedViewSchema>;
