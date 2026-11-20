import { z } from "zod";

const dateSchema = z.string().datetime().or(z.string().date());

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  boqItemId: z.string().uuid().nullish(),
  itemCode: z.string().max(100).nullish(),
  description: z.string().min(1).max(2000),
  unit: z.string().max(50).nullish(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
});

export const createClientPurchaseOrderSchema = z.object({
  poNumber: z.string().trim().min(1).max(100),
  poDate: dateSchema,
  deliveryDueDate: dateSchema.optional(),
  notes: z.string().max(2000).nullish(),
  items: z.array(itemSchema).min(1, "At least one item is required"),
});
export type CreateClientPurchaseOrderBody = z.infer<typeof createClientPurchaseOrderSchema>;

export const updateClientPurchaseOrderSchema = createClientPurchaseOrderSchema.partial();
export type UpdateClientPurchaseOrderBody = z.infer<typeof updateClientPurchaseOrderSchema>;
