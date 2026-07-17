import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Rendered for a date/number that genuinely has no value, rather than a misleading 0/epoch. */
export const EMPTY_VALUE = "—";

// India is this app's only market (see india-locations.ts) — dates display as
// DD/MM/YYYY everywhere rather than following each browser's own locale.
// Accepts null/undefined because plenty of dates are legitimately unknown (a tender's
// submission deadline may not be stated in its source document) — formatting those as
// "01/01/1970" would be worse than saying nothing.
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return EMPTY_VALUE;
  return new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return EMPTY_VALUE;
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
