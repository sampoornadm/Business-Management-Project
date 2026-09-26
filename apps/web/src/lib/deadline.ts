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

export function deadlineLabel(daysLeft: number, pastDue: boolean): string {
  if (pastDue) return "Closed";
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `${daysLeft} days left`;
}
