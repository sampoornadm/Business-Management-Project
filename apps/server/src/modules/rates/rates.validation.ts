import { HISTORICAL_RATE_CATEGORIES } from "@bmp/types";
import { z } from "zod";

const historicalRateCategorySchema = z.enum(HISTORICAL_RATE_CATEGORIES);

export const listHistoricalRatesQuerySchema = z.object({
  category: historicalRateCategorySchema.optional(),
  itemName: z.string().min(1).optional(),
});
export type ListHistoricalRatesQuery = z.infer<typeof listHistoricalRatesQuerySchema>;

export const suggestHistoricalRatesQuerySchema = z.object({
  category: historicalRateCategorySchema,
  itemName: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export type SuggestHistoricalRatesQueryParsed = z.infer<typeof suggestHistoricalRatesQuerySchema>;

export const createHistoricalRateSchema = z.object({
  category: historicalRateCategorySchema,
  itemName: z.string().min(1).max(200),
  unit: z.string().min(1).max(50),
  rate: z.number().nonnegative(),
  location: z.string().max(200).optional(),
  effectiveDate: z.string().datetime().or(z.string().date()),
  sourceTenderId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
});
export type CreateHistoricalRateBody = z.infer<typeof createHistoricalRateSchema>;
