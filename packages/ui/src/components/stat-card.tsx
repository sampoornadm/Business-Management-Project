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
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ label, value, icon: Icon, isLoading = false, className, ...props }, ref) => (
    <Card ref={ref} className={className} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="font-mono text-2xl font-bold">{value}</div>
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
