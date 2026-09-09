"use client";

import { Circle, CircleDot } from "lucide-react";
import * as React from "react";

import { operatorLabel, operatorsForColumn } from "../lib/filterable-column";
import type { FilterableColumnDef, FilterCondition, FilterOperator } from "../lib/filterable-column";

import { Button } from "./button";
import { Input } from "./input";
import { MultiSelect } from "./multi-select";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface AddFilterPopoverProps {
  columns: FilterableColumnDef[];
  /** Present when editing an existing chip; omitted when adding a new one. */
  initialCondition?: FilterCondition | null;
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (condition: FilterCondition) => void;
}

function defaultOperator(column: FilterableColumnDef): FilterOperator {
  return operatorsForColumn(column)[0]!;
}

/** The empty value shape for a given operator: scalar, between two-tuple, or any_of array. */
function emptyValueForOperator(op: FilterOperator): FilterCondition["value"] {
  return op === "between" ? ["", ""] : op === "any_of" ? [] : "";
}

export function AddFilterPopover({
  columns,
  initialCondition,
  trigger,
  open,
  onOpenChange,
  onApply,
}: AddFilterPopoverProps) {
  const [selectedKey, setSelectedKey] = React.useState<string | null>(initialCondition?.columnKey ?? null);
  const [operator, setOperator] = React.useState<FilterOperator | null>(initialCondition?.operator ?? null);
  const [value, setValue] = React.useState<FilterCondition["value"]>(initialCondition?.value ?? "");

  React.useEffect(() => {
    if (!open) return;
    setSelectedKey(initialCondition?.columnKey ?? null);
    setOperator(initialCondition?.operator ?? null);
    setValue(initialCondition?.value ?? "");
  }, [open, initialCondition]);

  const selectedColumn = columns.find((column) => column.key === selectedKey) ?? null;

  function pickColumn(column: FilterableColumnDef) {
    setSelectedKey(column.key);
    const op = defaultOperator(column);
    setOperator(op);
    setValue(emptyValueForOperator(op));
  }

  function handleApply() {
    if (!selectedColumn || !operator) return;
    onApply({ columnKey: selectedColumn.key, operator, value });
    onOpenChange(false);
  }

  function renderValueInput() {
    if (!selectedColumn || !operator || operator === "has_any_value") return null;

    if (operator === "between") {
      const [min, max] = Array.isArray(value) ? value : ["", ""];
      const inputType = selectedColumn.type === "date" ? "date" : "number";
      return (
        <div className="flex items-center gap-2">
          <Input type={inputType} value={min ?? ""} onChange={(e) => setValue([e.target.value, max ?? ""])} />
          <span className="text-muted-foreground">and</span>
          <Input type={inputType} value={max ?? ""} onChange={(e) => setValue([min ?? "", e.target.value])} />
        </div>
      );
    }

    if (selectedColumn.type === "enum" && operator === "any_of") {
      return (
        <MultiSelect
          options={selectedColumn.enumOptions ?? []}
          selected={Array.isArray(value) ? (value as string[]) : []}
          onChange={(selected) => setValue(selected)}
        />
      );
    }

    if (selectedColumn.type === "enum") {
      return (
        <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => setValue(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a value" />
          </SelectTrigger>
          <SelectContent>
            {(selectedColumn.enumOptions ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    const inputType = selectedColumn.type === "date" ? "date" : selectedColumn.type === "number" ? "number" : "text";
    return (
      <Input
        type={inputType}
        value={typeof value === "string" || typeof value === "number" ? value : ""}
        onChange={(e) => setValue(selectedColumn.type === "number" ? Number(e.target.value) : e.target.value)}
      />
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[28rem] p-0">
        <div className="flex">
          <div className="w-40 border-r p-1">
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                onClick={() => pickColumn(column)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  selectedKey === column.key ? "bg-accent font-medium" : ""
                }`}
              >
                {column.label}
              </button>
            ))}
          </div>
          <div className="flex-1 space-y-3 p-3">
            {selectedColumn ? (
              <>
                <div className="space-y-1">
                  {operatorsForColumn(selectedColumn).map((op) => (
                    <button
                      key={op}
                      type="button"
                      role="radio"
                      aria-checked={operator === op}
                      onClick={() => {
                        setOperator(op);
                        setValue(emptyValueForOperator(op));
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                    >
                      {operator === op ? (
                        <CircleDot className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {operatorLabel(op)}
                    </button>
                  ))}
                </div>
                {renderValueInput()}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={handleApply} disabled={!operator}>
                    Apply Filter
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Pick a column to filter by.</p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
