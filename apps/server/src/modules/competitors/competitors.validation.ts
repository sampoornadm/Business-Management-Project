import { z } from "zod";

export const competitorIdParamsSchema = z.object({ id: z.string().uuid() });
export const tenderIdParamsSchema = z.object({ tenderId: z.string().uuid() });
export const itemCodeParamsSchema = z.object({ itemCode: z.string().trim().min(1).max(64) });
export const listItemsQuerySchema = z.object({ search: z.string().trim().max(200).optional() });
export const updateCompetitorSchema = z.object({ isSelf: z.boolean() });

export type ListItemsQuery = z.infer<typeof listItemsQuerySchema>;
export type UpdateCompetitorBody = z.infer<typeof updateCompetitorSchema>;
