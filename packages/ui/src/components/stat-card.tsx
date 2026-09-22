"use client";

import * as React from "react";

import { cn } from "../lib/utils";

import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Skeleton } from "./skeleton";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  isLoading?: boolean;
  /** Small secondary line under the value (a definition, a period, a comparison). */
  hint?: React.ReactNode;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, icon: Icon, isLoading = false, hint, className, ...props }, ref) => (
    // min-w-0 lets the card shrink inside a grid track instead of being propped open by a long
    // value; break-words then wraps an over-long number inside the card rather than spilling out.
    <Card ref={ref} className={cn("min-w-0", className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="truncate text-sm font-medium">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <div className="break-words font-mono text-xl font-bold leading-tight xl:text-2xl">{value}</div>
            {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
          </>
        )}
      </CardContent>
    </Card>
  ),
);
StatCard.displayName = "StatCard";

const KpiGrid = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)} {...props} />
  ),
);
KpiGrid.displayName = "KpiGrid";

export { StatCard, KpiGrid };
