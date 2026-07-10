import { z } from "zod";

export const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(20),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().max(20).optional(),
  gstNumber: z.string().max(30).optional(),
  udyamRegistrationNumber: z.string().max(50).optional(),
  msmeCategory: z.enum(["MICRO", "SMALL", "MEDIUM"]).optional(),
  panNumber: z.string().max(20).optional(),
  website: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateBusinessBody = z.infer<typeof createBusinessSchema>;

export const updateBusinessSchema = createBusinessSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateBusinessBody = z.infer<typeof updateBusinessSchema>;

export const listBusinessesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>;

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

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export type AddMemberBody = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z.object({
  roleId: z.string().uuid(),
});
export type UpdateMemberBody = z.infer<typeof updateMemberSchema>;
