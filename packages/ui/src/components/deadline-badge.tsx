"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface DeadlineBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Calendar days remaining until the deadline (negative = past due). Null renders nothing. */
  daysLeft: number | null;
  /** Display text — callers compute wording (e.g. "3 days left", "Closed"), this only colors it. */
  label: string;
  /** daysLeft value that maps to full green; 0 or less maps to full red. */
  fullGreenDays?: number;
}

/**
 * A small color-coded countdown pill for any upcoming deadline — green with plenty of time,
 * sliding through yellow/orange to red as it approaches or passes. Domain-agnostic: the caller
 * supplies the day count and label text (see apps/web/src/lib/deadline.ts for the tender
 * submission-deadline wiring); this component only does the color math and rendering.
 *
 * The gradient is `color-mix()` between --deadline-safe and --deadline-due (globals.css) — not
 * --success/--destructive, which are tuned muted for a status Badge sitting quietly next to
 * plain text and mix to a dull olive in the middle of the range. This still follows light/dark
 * theme automatically, and a green-to-red HSL mix naturally sweeps through yellow/orange along
 * the way (the shorter hue arc from ~142° to 0°).
 */
function DeadlineBadge({ daysLeft, label, fullGreenDays = 14, className, style, ...props }: DeadlineBadgeProps) {
  if (daysLeft === null) return null;
  const pct = Math.max(0, Math.min(1, daysLeft / fullGreenDays)) * 100;

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border border-transparent px-2.5 py-0.5 text-xs font-semibold text-white",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in hsl, hsl(var(--deadline-safe)) ${pct}%, hsl(var(--deadline-due)))`,
        ...style,
      }}
      {...props}
    >
      {label}
    </span>
  );
}

export { DeadlineBadge };
