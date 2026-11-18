"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Status/kind badges shown inline after the title. */
  badges?: React.ReactNode;
  /** Buttons, right-aligned; see the Buttons convention in CLAUDE.md for their order. */
  actions?: React.ReactNode;
  /** A "back to parent" link shown above the title. */
  back?: React.ReactNode;
  /** Extra lines under the title (links, counts, a status tracker). */
  children?: React.ReactNode;
}

/** The one header for every page: list, form and detail pages alike. */
const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, badges, actions, back, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}
      {...props}
    >
      {/* basis-72 keeps the title readable: when the buttons leave it less, they drop to their own row. */}
      <div className="min-w-0 flex-1 basis-72">
        {back && <div className="mb-1 text-sm text-muted-foreground">{back}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{title}</h1>
          {badges}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && (
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 empty:hidden">{actions}</div>
      )}
    </div>
  ),
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
