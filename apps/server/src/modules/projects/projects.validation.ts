import { BILL_STATUSES, LABOR_CATEGORIES, MILESTONE_STATUSES, PROJECT_STATUSES } from "@bmp/types";
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

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ListProjectsQueryParsed = z.infer<typeof listProjectsQuerySchema>;

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
