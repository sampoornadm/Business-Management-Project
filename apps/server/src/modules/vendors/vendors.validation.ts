import { FILTER_OPERATORS, VENDOR_CATEGORIES, VENDOR_FILTER_FIELDS, VENDOR_SORT_FIELDS } from "@bmp/types";
import { z } from "zod";

const vendorCategorySchema = z.enum(VENDOR_CATEGORIES);

export const createVendorSchema = z.object({
  name: z.string().min(1).max(200),
  category: vendorCategorySchema,
  gstNumber: z.string().max(30).optional(),
  panNumber: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  bankAccountName: z.string().max(150).optional(),
  bankAccountNumber: z.string().max(50).optional(),
  bankIfscCode: z.string().max(20).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateVendorBody = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateVendorBody = z.infer<typeof updateVendorSchema>;

const filterConditionSchema = z.object({
  columnKey: z.enum(VENDOR_FILTER_FIELDS),
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

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  category: vendorCategorySchema.optional(),
  isActive: z.coerce.boolean().optional(),
  filters: filtersQueryParam,
  sortBy: z.enum(VENDOR_SORT_FIELDS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export const exportVendorsQuerySchema = listVendorsQuerySchema.extend({
  format: z.enum(["csv", "xlsx"]),
  scope: z.enum(["view", "all"]),
  columns: z.preprocess(
    (value) => (typeof value === "string" ? value.split(",") : value),
    z.array(z.string()).optional(),
  ),
});
export type ExportVendorsQuery = z.infer<typeof exportVendorsQuerySchema>;

export const createVendorItemTagSchema = z.object({
  itemType: z.string().min(1).max(100),
  make: z.string().max(100).optional(),
});
export type CreateVendorItemTagBody = z.infer<typeof createVendorItemTagSchema>;

export {
  createContactSchema,
  updateContactSchema,
  type CreateContactBody,
  type UpdateContactBody,
} from "../contacts/contacts.validation.js";
