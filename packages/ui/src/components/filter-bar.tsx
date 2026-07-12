"use client";

import * as React from "react";

import { cn } from "../lib/utils";

const FilterBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-wrap items-center gap-3", className)} {...props} />
  ),
);
FilterBar.displayName = "FilterBar";

export { FilterBar };
