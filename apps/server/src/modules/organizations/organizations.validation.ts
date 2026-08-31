import { ORGANIZATION_TYPES } from "@bmp/types";
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

export const listOrganizationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  type: organizationTypeSchema.optional(),
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;

export {
  createContactSchema,
  updateContactSchema,
  type CreateContactBody,
  type UpdateContactBody,
} from "../contacts/contacts.validation.js";
