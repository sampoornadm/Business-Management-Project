"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

export interface StepperStep {
  key: string;
  label: string;
  state: "complete" | "current" | "upcoming";
}

export interface StepperProps {
  steps: StepperStep[];
  className?: string;
}

export function Stepper({ steps, className }: StepperProps) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <ol className="flex min-w-max items-start">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;

          return (
            <li key={step.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium",
                    step.state === "complete" && "border-primary bg-primary text-primary-foreground",
                    step.state === "current" && "border-primary bg-background text-primary",
                    step.state === "upcoming" && "border-transparent bg-muted text-muted-foreground",
                  )}
                >
                  {step.state === "complete" ? (
                    <Check className="h-4 w-4" />
                  ) : step.state === "current" ? (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 max-w-[6rem] truncate text-center text-xs font-medium",
                    step.state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                  )}
                  title={step.label}
                >
                  {step.label}
                </span>
              </div>

              {!isLast ? (
                <div
                  className={cn(
                    "mb-5 h-0.5 w-10 shrink-0 sm:w-16",
                    step.state === "complete" ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
