"use client";

import { Input } from "@bmp/ui";
import { useState } from "react";

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
