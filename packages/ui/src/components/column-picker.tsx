"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ColumnPickerColumn {
  key: string;
  label: string;
}

export interface ColumnPickerProps {
  columns: ColumnPickerColumn[];
  visibleKeys: string[];
  order: string[];
  defaultVisibleKeys: string[];
  defaultOrder: string[];
  onChange: (next: { visibleKeys: string[]; order: string[] }) => void;
}

function SortableRow({
  column,
  checked,
  onToggle,
}: {
  column: ColumnPickerColumn;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: column.key });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
      <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox checked={checked} onCheckedChange={(value) => onToggle(value === true)} />
      <span className="text-sm">{column.label}</span>
    </div>
  );
}

export function ColumnPicker({
  columns,
  visibleKeys,
  order,
  defaultVisibleKeys,
  defaultOrder,
  onChange,
}: ColumnPickerProps) {
  const [open, setOpen] = React.useState(false);
  const sensors = useSensors(useSensor(PointerSensor));
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const orderedColumns = order
    .map((key) => columnByKey.get(key))
    .filter((column): column is ColumnPickerColumn => Boolean(column));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    const next = [...order];
    next.splice(oldIndex, 1);
    next.splice(newIndex, 0, String(active.id));
    onChange({ visibleKeys, order: next });
  }

  function toggle(key: string, checked: boolean) {
    const next = checked ? [...visibleKeys, key] : visibleKeys.filter((k) => k !== key);
    onChange({ visibleKeys: next, order });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal className="mr-2 h-4 w-4" /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {orderedColumns.map((column) => (
                <SortableRow
                  key={column.key}
                  column={column}
                  checked={visibleKeys.includes(column.key)}
                  onToggle={(checked) => toggle(column.key, checked)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2 w-full"
          onClick={() => onChange({ visibleKeys: defaultVisibleKeys, order: defaultOrder })}
        >
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  );
}
