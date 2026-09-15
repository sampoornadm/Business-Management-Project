import {
  BILL_STATUSES,
  FILTER_OPERATORS,
  LABOR_CATEGORIES,
  MILESTONE_STATUSES,
  PROJECT_FILTER_FIELDS,
  PROJECT_SORT_FIELDS,
  PROJECT_STATUSES,
} from "@bmp/types";
import { z } from "zod";

const dateSchema = z.string().datetime().or(z.string().date());

export const createProjectFromTenderSchema = z.object({
  tenderId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateProjectFromTenderBody = z.infer<typeof createProjectFromTenderSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  budget: z.number().nonnegative().optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  actualEndDate: dateSchema.optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

const filterConditionSchema = z.object({
  columnKey: z.enum(PROJECT_FILTER_FIELDS),
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

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(PROJECT_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListProjectsQueryParsed = z.infer<typeof listProjectsQuerySchema>;

export const exportProjectsQuerySchema = listProjectsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportProjectsQueryParsed = z.infer<typeof exportProjectsQuerySchema>;

export const createMilestoneSchema = z.object({
  title: z.string().min(1).max(200),
  plannedDate: dateSchema.optional(),
  weightPercent: z.number().min(0).max(100).optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateMilestoneBody = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    plannedDate: dateSchema.optional(),
    completedDate: dateSchema.optional(),
    status: z.enum(MILESTONE_STATUSES).optional(),
    weightPercent: z.number().min(0).max(100).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneSchema>;

export const createMaterialUsageSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  materialName: z.string().min(1).max(200),
  unit: z.string().max(50).optional(),
  quantityUsed: z.number().positive(),
  usageDate: dateSchema.optional(),
  remarks: z.string().max(1000).optional(),
});
export type CreateMaterialUsageBody = z.infer<typeof createMaterialUsageSchema>;

export const createLaborEntrySchema = z.object({
  category: z.enum(LABOR_CATEGORIES),
  description: z.string().min(1).max(500),
  workerCount: z.number().int().positive(),
  units: z.number().positive(),
  ratePerUnit: z.number().nonnegative(),
  entryDate: dateSchema.optional(),
  remarks: z.string().max(1000).optional(),
});
export type CreateLaborEntryBody = z.infer<typeof createLaborEntrySchema>;

export const createBillSchema = z.object({
  billNumber: z.string().min(1).max(50),
  billDate: dateSchema.optional(),
  cumulativeAmount: z.number().nonnegative(),
  remarks: z.string().max(1000).optional(),
});
export type CreateBillBody = z.infer<typeof createBillSchema>;

export const updateBillStatusSchema = z.object({
  status: z.enum(BILL_STATUSES),
});
export type UpdateBillStatusBody = z.infer<typeof updateBillStatusSchema>;
