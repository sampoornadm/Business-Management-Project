import { z } from "zod";

// `z.coerce.boolean()` runs the query string through `Boolean(...)`, so the string "false" (any
// non-empty string) coerces to `true` — this schema treats the literal strings "true"/"false"
// correctly instead.
const booleanQueryParam = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  isRead: booleanQueryParam,
  allBusinesses: booleanQueryParam,
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const markAllReadQuerySchema = z.object({
  allBusinesses: booleanQueryParam,
});
