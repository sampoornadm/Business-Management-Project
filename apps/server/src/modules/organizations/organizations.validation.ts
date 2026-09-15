import {
  FILTER_OPERATORS,
  ORGANIZATION_FILTER_FIELDS,
  ORGANIZATION_SORT_FIELDS,
  ORGANIZATION_TYPES,
} from "@bmp/types";
import { z } from "zod";

const organizationTypeSchema = z.enum(ORGANIZATION_TYPES);

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  type: organizationTypeSchema,
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(20).optional(),
  gstNumber: z.string().max(30).optional(),
  website: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial();
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>;

const filterConditionSchema = z.object({
  columnKey: z.enum(ORGANIZATION_FILTER_FIELDS),
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

export const listOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  type: organizationTypeSchema.optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(ORGANIZATION_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;

export const exportOrganizationsQuerySchema = listOrganizationsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportOrganizationsQuery = z.infer<typeof exportOrganizationsQuerySchema>;

export {
  createContactSchema,
  updateContactSchema,
  type CreateContactBody,
  type UpdateContactBody,
} from "../contacts/contacts.validation.js";
