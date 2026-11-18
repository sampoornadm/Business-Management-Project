"use client";

import * as React from "react";

import { cn } from "../lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * A rate/amount box: while not being edited it shows the value in Indian accounting format
   * (lakh/crore grouping, two decimals); while focused it shows the plain number for typing.
   * `value`/`onChange` still carry the plain numeric string. Replaces `type="number"`.
   */
  money?: boolean;
}

const indianNumber = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function formatIndianNumber(value: InputProps["value"]): InputProps["value"] {
  if (value === undefined || value === null || String(value).trim() === "") return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? value : indianNumber.format(parsed);
}

/**
 * Up/Down inside a table moves to the same column's box in the previous/next row, skipping rows
 * that have none (category rows, read-only lines). Leaving the box blurs it, which is what
 * commits an inline edit, so "type a rate, press Down" saves and lands on the next rate.
 */
function focusSameColumn(input: HTMLInputElement, direction: 1 | -1): void {
  const cell = input.closest("td");
  let row = cell?.parentElement as HTMLTableRowElement | null | undefined;
  if (!cell || !row) return;
  for (;;) {
    row = (direction === 1 ? row.nextElementSibling : row.previousElementSibling) as HTMLTableRowElement | null;
    if (!row) return;
    const target = row.cells[cell.cellIndex]?.querySelector<HTMLInputElement>(
      "input:not([type=checkbox]):not([type=file]):not(:disabled)",
    );
    if (target) {
      target.focus();
      target.select();
      return;
    }
  }
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, money = false, value, onChange, onFocus, onBlur, onKeyDown, onWheel, ...props }, ref) => {
    const [focused, setFocused] = React.useState(false);
    const numeric = money || type === "number";

    return (
      <input
        type={money ? "text" : type}
        inputMode={money ? "decimal" : undefined}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          money && "text-right tabular-nums",
          className,
        )}
        ref={ref}
        value={money && !focused ? formatIndianNumber(value) : value}
        onChange={(event) => {
          // A money box is a text input, so keep it to digits, one sign and the decimal point.
          if (money) event.target.value = event.target.value.replace(/[^0-9.-]/g, "");
          onChange?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
          if (money) {
            // Select once the plain number has replaced the formatted text, so typing overwrites it.
            const element = event.currentTarget;
            requestAnimationFrame(() => {
              if (document.activeElement === element) element.select();
            });
          }
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
          const inTable = Boolean(event.currentTarget.closest("td"));
          // Never let the arrows step a number up or down: they move between rows instead.
          if (numeric || inTable) event.preventDefault();
          if (inTable) focusSameColumn(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
        }}
        onWheel={(event) => {
          onWheel?.(event);
          // A focused number box changes its value when scrolled over; dropping focus stops that
          // and lets the page scroll.
          if (type === "number" && document.activeElement === event.currentTarget) event.currentTarget.blur();
        }}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
