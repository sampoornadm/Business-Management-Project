"use client";

import { CircleSlash, Clock } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

export interface DeadlineProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pre-formatted exact date/time text, always shown as-is. */
  dateText: string;
  /** Calendar days remaining until the deadline (negative = past due); picks the urgency tone. */
  daysLeft: number;
  /** The countdown in words (e.g. "3 days left", "5 hours left", "Closed"). */
  label: string;
  /** True once the deadline has actually passed. */
  pastDue?: boolean;
}

/**
 * A deadline shown as its exact date/time plus a countdown pill that says the time left in words.
 * The pill's tone steps with urgency: green with more than a week to go, amber inside the last
 * week, solid red for today/tomorrow, neutral grey once closed ("closed" must read as over, not
 * as maximally urgent). The words carry the meaning; colour only reinforces it.
 *
 * Replaced a shrinking green-to-red bar: its length was a share of an arbitrary 14-day window, so
 * it never read as "time remaining". Domain-agnostic: the caller supplies the formatted date, the
 * day count and the label (see apps/web/src/lib/deadline.ts for the tender wiring).
 */
function DeadlineProgress({ dateText, daysLeft, label, pastDue = false, className, ...props }: DeadlineProgressProps) {
  const tone = pastDue
    ? "bg-muted text-muted-foreground"
    : daysLeft <= 1
      ? "bg-destructive text-destructive-foreground"
      : daysLeft <= 7
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-success/15 text-success";
  const Icon = pastDue ? CircleSlash : Clock;

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <p className="tabular-nums">{dateText}</p>
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
          tone,
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

export { DeadlineProgress };
