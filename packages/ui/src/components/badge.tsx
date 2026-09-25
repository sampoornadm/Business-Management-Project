"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Sparkles } from "lucide-react";
import * as React from "react";


import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        signal: "border-transparent bg-signal text-signal-foreground hover:bg-signal/80",
        success: "border-transparent bg-success text-success-foreground hover:bg-success/80",
        ai: "border-transparent bg-ai text-ai-foreground hover:bg-ai/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * The app's one visual marker for AI-suggested / autosuggested content — anything a model
 * proposed rather than a human entered. Use it wherever such a value is shown (BOQ item
 * category, HSN suggestion, suggested rate, etc.) instead of a plain Badge, so the same
 * icon+color reads as "the app proposed this" everywhere in the product.
 */
function AiBadge({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn(badgeVariants({ variant: "ai" }), "gap-1", className)} {...props}>
      <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}

export { AiBadge, Badge, badgeVariants };
