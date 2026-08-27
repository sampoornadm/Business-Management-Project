import { z } from "zod";

export const assistantQuerySchema = z.object({
  message: z.string().min(1).max(500),
});
export type AssistantQueryBody = z.infer<typeof assistantQuerySchema>;
