import { FILTER_OPERATORS, THEME_COLOR_KEYS, USER_FILTER_FIELDS, USER_SORT_FIELDS } from "@bmp/types";
import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
  roleId: z.string().uuid(),
});
export type CreateUserBody = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserBody = z.infer<typeof updateUserSchema>;

export const updateOwnProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).nullable().optional(),
});
export type UpdateOwnProfileBody = z.infer<typeof updateOwnProfileSchema>;

export const updateThemeColorSchema = z.object({
  businessId: z.string().uuid(),
  themeColor: z.enum(THEME_COLOR_KEYS),
});
export type UpdateThemeColorBody = z.infer<typeof updateThemeColorSchema>;

export const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
});
export type AssignRoleBody = z.infer<typeof assignRoleSchema>;

const filterConditionSchema = z.object({
  columnKey: z.enum(USER_FILTER_FIELDS),
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

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  roleId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(USER_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const exportUsersQuerySchema = listUsersQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportUsersQueryParsed = z.infer<typeof exportUsersQuerySchema>;
