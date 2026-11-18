import type { RateForecastDto } from "@bmp/types";
import { cn, formatMoney } from "@bmp/ui";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

const TRENDS = {
  RISING: { label: "Rising", icon: TrendingUp },
  FALLING: { label: "Falling", icon: TrendingDown },
  FLAT: { label: "Flat", icon: Minus },
} as const;

/** Which way a bidder's rate for an item has been heading; nothing to say with a single quote. */
export function TrendLabel({ forecast, className }: { forecast: RateForecastDto; className?: string }) {
  if (!forecast.direction) return <span className={cn("text-muted-foreground", className)}>One quote so far</span>;
  const { label, icon: Icon } = TRENDS[forecast.direction];
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** The predicted next rate, always worded as a prediction; the last rate when history is too thin. */
export function PredictedRate({ forecast, className }: { forecast: RateForecastDto; className?: string }) {
  if (forecast.predictedRate === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {formatMoney(forecast.lastRate)} <span className="text-xs">last</span>
      </span>
    );
  }
  return <span className={cn("font-medium tabular-nums", className)}>{formatMoney(forecast.predictedRate)}</span>;
}
