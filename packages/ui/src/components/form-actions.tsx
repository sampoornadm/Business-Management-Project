"use client";

import * as React from "react";

import { cn } from "../lib/utils";

import { Button } from "./button";

export interface FormActionsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Renders a Cancel button after the children when provided. */
  onCancel?: () => void;
}

/**
 * The action row of a full-page form. Sticks to the bottom of the scroll
 * area so Save stays reachable without scrolling to the end of a long form.
 * Order: primary action first, Cancel after it.
 */
const FormActions = React.forwardRef<HTMLDivElement, FormActionsProps>(
  ({ onCancel, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t bg-background/95 py-3 backdrop-blur",
        className,
      )}
      {...props}
    >
      {children}
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  ),
);
FormActions.displayName = "FormActions";

export { FormActions };
