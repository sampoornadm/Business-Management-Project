"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { operatorLabel } from "../lib/filterable-column";
import type { FilterableColumnDef, FilterCondition } from "../lib/filterable-column";

import { AddFilterPopover } from "./add-filter-popover";
import { Button } from "./button";

function valueLabel(column: FilterableColumnDef, condition: FilterCondition): string {
  if (condition.operator === "has_any_value") return "";
  if (Array.isArray(condition.value)) {
    if (condition.operator === "between") return `${condition.value[0]} and ${condition.value[1]}`;
    if (column.enumOptions) {
      const labels = condition.value.map(
        (v) => column.enumOptions!.find((option) => option.value === v)?.label ?? String(v),
      );
      return labels.join(", ");
    }
    return condition.value.join(", ");
  }
  if (column.enumOptions) {
    return column.enumOptions.find((option) => option.value === condition.value)?.label ?? String(condition.value ?? "");
  }
  return String(condition.value ?? "");
}

export interface ActiveFilterChipsProps {
  columns: FilterableColumnDef[];
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
}

export function ActiveFilterChips({ columns, conditions, onChange }: ActiveFilterChipsProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);

  function removeAt(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function applyEdit(condition: FilterCondition) {
    if (editingIndex === null) return;
    const next = [...conditions];
    next[editingIndex] = condition;
    onChange(next);
    setEditingIndex(null);
  }

  function applyNew(condition: FilterCondition) {
    onChange([...conditions, condition]);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {conditions.map((condition, index) => {
        const column = columns.find((c) => c.key === condition.columnKey);
        if (!column) return null;
        return (
          <AddFilterPopover
            key={`${condition.columnKey}-${index}`}
            columns={columns}
            initialCondition={condition}
            open={editingIndex === index}
            onOpenChange={(open) => setEditingIndex(open ? index : null)}
            onApply={applyEdit}
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm hover:bg-accent"
              >
                <span>
                  {column.label} {operatorLabel(condition.operator)} {valueLabel(column, condition)}
                </span>
                <X
                  className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeAt(index);
                  }}
                />
              </button>
            }
          />
        );
      })}
      <AddFilterPopover
        columns={columns}
        open={addOpen}
        onOpenChange={setAddOpen}
        onApply={applyNew}
        trigger={
          <Button type="button" variant="outline" size="icon" className="h-8 w-8">
            <Plus className="h-4 w-4" />
          </Button>
        }
      />
      {conditions.length > 0 && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
          Clear all
        </Button>
      )}
    </div>
  );
}
