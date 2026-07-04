import { REPORT_EXPORT_FORMATS, REPORT_KEYS } from "@bmp/types";
import { z } from "zod";

export const reportDateRangeQuerySchema = z.object({
  from: z.string().datetime().or(z.string().date()).optional(),
  to: z.string().datetime().or(z.string().date()).optional(),
});
export type ReportDateRangeQueryParsed = z.infer<typeof reportDateRangeQuerySchema>;

export const exportReportParamsSchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
});
export type ExportReportParams = z.infer<typeof exportReportParamsSchema>;

export const exportReportQuerySchema = reportDateRangeQuerySchema.extend({
  format: z.enum(REPORT_EXPORT_FORMATS),
});
export type ExportReportQueryParsed = z.infer<typeof exportReportQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1),
});
export type SearchQueryParsed = z.infer<typeof searchQuerySchema>;
