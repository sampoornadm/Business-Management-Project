import { z } from "zod";

export const listLookupOptionsQuerySchema = z.object({
  kind: z.enum(["DEPARTMENT", "DESIGNATION"]),
});
export type ListLookupOptionsQuery = z.infer<typeof listLookupOptionsQuerySchema>;

export const contactPhoneSchema = z.object({
  phone: z.string().min(1, "Required").max(30),
  isPrimary: z.boolean(),
});

export const contactEmailSchema = z.object({
  email: z.string().email("Invalid email"),
  isPrimary: z.boolean(),
});

function atMostOnePrimary(items: { isPrimary: boolean }[] | undefined): boolean {
  if (!items) return true;
  return items.filter((item) => item.isPrimary).length <= 1;
}

export const createContactSchema = z.object({
  name: z.string().min(1, "Required").max(150),
  department: z.string().max(150).optional(),
  designation: z.string().max(150).optional(),
  notes: z.string().max(2000).optional(),
  isPrimary: z.boolean().optional(),
  phones: z.array(contactPhoneSchema).max(10).optional(),
  emails: z.array(contactEmailSchema).max(10).optional(),
}).refine((data) => atMostOnePrimary(data.phones), {
  message: "At most one phone number can be marked primary",
  path: ["phones"],
}).refine((data) => atMostOnePrimary(data.emails), {
  message: "At most one email can be marked primary",
  path: ["emails"],
});
export type CreateContactBody = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  name: z.string().min(1, "Required").max(150).optional(),
  department: z.string().max(150).optional(),
  designation: z.string().max(150).optional(),
  notes: z.string().max(2000).optional(),
  isPrimary: z.boolean().optional(),
  phones: z.array(contactPhoneSchema).max(10).optional(),
  emails: z.array(contactEmailSchema).max(10).optional(),
}).refine((data) => atMostOnePrimary(data.phones), {
  message: "At most one phone number can be marked primary",
  path: ["phones"],
}).refine((data) => atMostOnePrimary(data.emails), {
  message: "At most one email can be marked primary",
  path: ["emails"],
});
export type UpdateContactBody = z.infer<typeof updateContactSchema>;
