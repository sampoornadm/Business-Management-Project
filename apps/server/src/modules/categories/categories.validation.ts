import { z } from "zod";

export const createCategorySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().optional(),
});
export type CreateCategoryBody = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((d) => d.name !== undefined || d.sortOrder !== undefined, {
    message: "Nothing to update",
  });
export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>;
