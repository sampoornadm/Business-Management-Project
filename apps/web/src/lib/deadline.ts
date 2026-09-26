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

export function deadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) return "Closed";
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "Due tomorrow";
  return `${daysLeft} days left`;
}
