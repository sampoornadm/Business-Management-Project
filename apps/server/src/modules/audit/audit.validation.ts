import { AUDIT_LOG_FILTER_FIELDS, AUDIT_LOG_SORT_FIELDS, FILTER_OPERATORS } from "@bmp/types";
import { z } from "zod";

const filterConditionSchema = z.object({
  columnKey: z.enum(AUDIT_LOG_FILTER_FIELDS),
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

export const listAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  entityType: z.string().optional(),
  actorId: z.string().uuid().optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(AUDIT_LOG_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListAuditLogsQueryParsed = z.infer<typeof listAuditLogsQuerySchema>;

export const exportAuditLogsQuerySchema = listAuditLogsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportAuditLogsQueryParsed = z.infer<typeof exportAuditLogsQuerySchema>;
