import { Star } from "lucide-react";

import { cn } from "../lib/utils";

const sizeClasses = {
  sm: "h-3.5 w-3.5",
  md: "h-5 w-5",
} as const;

export interface StarRatingProps {
  value: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
}

export function StarRating({ value, max = 5, size = "md", className }: StarRatingProps) {
  const fillPercent = Math.max(0, Math.min(1, value / max)) * 100;

  return (
    <span className={cn("relative inline-flex", className)}>
      <span className="flex gap-0.5 text-muted-foreground">
        {Array.from({ length: max }, (_, i) => (
          <Star key={i} className={sizeClasses[size]} />
        ))}
      </span>
      <span
        className="absolute inset-0 flex gap-0.5 overflow-hidden text-amber-500"
        style={{ width: `${fillPercent}%` }}
      >
        {Array.from({ length: max }, (_, i) => (
          <Star key={i} className={cn(sizeClasses[size], "fill-current shrink-0")} />
        ))}
      </span>
    </span>
  );
}
