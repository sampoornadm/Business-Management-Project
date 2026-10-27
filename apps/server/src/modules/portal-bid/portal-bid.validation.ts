import { z } from "zod";

export const updatePortalProfileSchema = z.object({
  answers: z.record(z.string().max(2000)),
});

export const tenderIdParamsSchema = z.object({ tenderId: z.string().uuid() });
export const fillJobParamsSchema = z.object({ jobId: z.string().uuid() });
