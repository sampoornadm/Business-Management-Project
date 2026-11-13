const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Calendar days remaining until `dueDate`, bucketed by local calendar date (not a raw 24h
 * count) — a deadline later today is 0, not a fraction rounded up to 1. Negative once the
 * deadline's calendar date has passed.
 */
export function daysUntil(dueDate: string | Date, now: Date = new Date()): number {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return Math.round((startOfDay(due) - startOfDay(now)) / MS_PER_DAY);
}

/**
 * True once the deadline's exact timestamp has passed — not just once its calendar date has, so
 * a deadline later today (e.g. 3pm) reads as still-open until 3pm actually passes, not the
 * moment the calendar flips to that date.
 */
export function isPastDue(dueDate: string | Date, now: Date = new Date()): boolean {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  return due.getTime() <= now.getTime();
}

/**
 * The time left in words. Inside the last 24 hours it counts hours (then minutes), because
 * "Due today" hides whether that means 20 hours or 20 minutes; beyond that it counts calendar days.
 */
export function timeLeftLabel(dueDate: string | Date, now: Date = new Date()): string {
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  const msLeft = due.getTime() - now.getTime();
  if (msLeft <= 0) return "Closed";

  const minutes = Math.ceil(msLeft / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(msLeft / 3_600_000);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;

  const days = daysUntil(due, now);
  return days === 1 ? "Due tomorrow" : `${days} days left`;
}
