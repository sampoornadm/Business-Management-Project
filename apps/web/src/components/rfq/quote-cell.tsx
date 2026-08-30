"use client";

import { Button, Input } from "@bmp/ui";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

export function QuoteCell({
  initialRate,
  onCommit,
  disabled,
  isSelected,
  onSelect,
  selectable,
}: {
  initialRate: number | null;
  onCommit: (rate: number) => void;
  disabled?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  selectable?: boolean;
}) {
  const [value, setValue] = useState(initialRate !== null ? String(initialRate) : "");

  // initialRate can change without this component remounting — e.g. a quote-sheet import for
  // this same vendor invalidates the whole RFQ query, and React reuses this exact input rather
  // than recreating it. Without this, the input keeps showing whatever it displayed at mount
  // (blank, if no rate existed yet) even after the real rate is saved and used everywhere else
  // (comparison totals, "Lowest" badge) — the data is correct, only this input goes stale.
  useEffect(() => {
    setValue(initialRate !== null ? String(initialRate) : "");
  }, [initialRate]);

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const parsed = Number(value);
          if (value.trim() !== "" && !Number.isNaN(parsed) && parsed !== initialRate) {
            onCommit(parsed);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Rate"
        className="h-8 w-28"
      />
      {selectable && initialRate !== null && (
        <Button
          type="button"
          size="icon"
          variant={isSelected ? "default" : "outline"}
          className="h-8 w-8 shrink-0"
          onClick={onSelect}
          aria-label={isSelected ? "Selected as final rate" : "Select as final rate"}
          title={isSelected ? "Selected as final rate" : "Select as final rate"}
        >
          <Check className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
