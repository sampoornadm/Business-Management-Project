"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface DeadlineProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-formatted date/time text — this component shows it as-is and adds the bar underneath. */
  dateText: string;
  /** Calendar days remaining until the deadline (negative = past due). */
  daysLeft: number;
  /** Caption next to the bar (e.g. "3 days left", "Due today", "Closed"). */
  label: string;
  /** True once the deadline has actually passed — renders a flat grey bar instead of the gradient. */
  pastDue?: boolean;
  /** daysLeft value that maps to a full bar; 0 or less maps to empty/red. */
  fullGreenDays?: number;
}

/**
 * A submission deadline shown as its real date/time, with a thin green-to-red bar underneath
 * tracking how much of the countdown window is left — length and color both shrink toward red as
 * the deadline approaches, and the bar goes flat grey once it's passed. Replaces the standalone
 * DeadlineBadge chip: showing the actual date was the point, the bar is what used to be a badge.
 *
 * Domain-agnostic like its predecessor — the caller supplies the formatted date, the day count,
 * and the label text (see apps/web/src/lib/deadline.ts for the tender submission-deadline
 * wiring). Past-due is deliberately flat grey rather than the gradient's red end, for the same
 * reason DeadlineBadge was: "closed" must read as neutral/over, not as maximally urgent.
 */
function DeadlineProgress({
  dateText,
  daysLeft,
  label,
  pastDue = false,
  fullGreenDays = 14,
  className,
  ...props
}: DeadlineProgressProps) {
  const pct = Math.max(0, Math.min(1, daysLeft / fullGreenDays)) * 100;

  return (
    <div className={cn("space-y-1.5", className)} {...props}>
      <p>{dateText}</p>
      <div className="flex items-center gap-2">
        <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full"
            style={
              pastDue
                ? { width: "100%", backgroundColor: "hsl(var(--muted-foreground))" }
                : {
                    width: `${pct}%`,
                    backgroundColor: `color-mix(in hsl, hsl(var(--deadline-safe)) ${pct}%, hsl(var(--deadline-due)))`,
                  }
            }
          />
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export { DeadlineProgress };
