import { VENDOR_CATEGORIES } from "@bmp/types";
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

export const listVendorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  category: vendorCategorySchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListVendorsQuery = z.infer<typeof listVendorsQuerySchema>;

export const createContactSchema = z.object({
  name: z.string().min(1).max(150),
  designation: z.string().max(150).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  isPrimary: z.boolean().optional(),
});
export type CreateContactBody = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactBody = z.infer<typeof updateContactSchema>;

export const createVendorItemTagSchema = z.object({
  itemType: z.string().min(1).max(100),
  make: z.string().max(100).optional(),
});
export type CreateVendorItemTagBody = z.infer<typeof createVendorItemTagSchema>;
