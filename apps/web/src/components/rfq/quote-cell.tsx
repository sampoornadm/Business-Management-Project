"use client";

import { Input } from "@bmp/ui";
import { useEffect, useState } from "react";

export function QuoteCell({
  initialRate,
  onCommit,
  disabled,
}: {
  initialRate: number | null;
  onCommit: (rate: number) => void;
  disabled?: boolean;
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
  );
}
