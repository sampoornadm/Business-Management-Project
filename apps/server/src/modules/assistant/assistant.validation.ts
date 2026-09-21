import { ASSISTANT_FILTER_KEYS } from "@bmp/types";
import { z } from "zod";

import { assistantStateSchema } from "./assistant.query.js";

export const assistantQuerySchema = z
  .object({
    message: z.string().trim().min(1).max(500).optional(),
    state: assistantStateSchema.nullable().optional(),
    removeFilter: z.enum(ASSISTANT_FILTER_KEYS).optional(),
  })
  // A turn is either a typed message, or a chip dismissal against an existing state.
  .refine((body) => body.message !== undefined || (body.removeFilter !== undefined && Boolean(body.state)), {
    message: "Provide a message, or a state with removeFilter",
  });
export type AssistantQueryBody = z.infer<typeof assistantQuerySchema>;
