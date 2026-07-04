import { z } from "zod";

export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #A1B2C3")
    .optional(),
});
export type CreateTagBody = z.infer<typeof createTagSchema>;

export const updateTagSchema = createTagSchema.partial();
export type UpdateTagBody = z.infer<typeof updateTagSchema>;
