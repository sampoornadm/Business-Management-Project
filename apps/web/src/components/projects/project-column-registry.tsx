"use client";

import type { ProjectListItemDto } from "@bmp/types";
import { PROJECT_STATUSES } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface ProjectColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<ProjectListItemDto>["cell"];
}

const STATUS_VARIANT: Record<ProjectListItemDto["status"], "success" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "success",
  ON_HOLD: "secondary",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

export const PROJECT_COLUMNS: ProjectColumnConfig[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/projects/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: PROJECT_STATUSES.map((s) => ({ value: s, label: s })),
    cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
  },
  {
    key: "budget",
    label: "Budget",
    type: "number",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.budget.toLocaleString(),
  },
  {
    key: "startDate",
    label: "Start Date",
    type: "date",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => formatDate(row.original.startDate),
  },
  {
    key: "endDate",
    label: "Planned End",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => (row.original.endDate ? formatDate(row.original.endDate) : "-"),
  },
];

export const PROJECT_DEFAULT_VISIBLE_KEYS = PROJECT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const PROJECT_DEFAULT_ORDER = PROJECT_COLUMNS.map((c) => c.key);

export function buildProjectColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<ProjectListItemDto>[] {
  const configByKey = new Map(PROJECT_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is ProjectColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      // TanStack's column.getCanSort() requires a truthy accessorFn regardless of
      // enableSorting — with none, getToggleSortingHandler() silently no-ops on click. Sorting
      // is fully server-driven (DataTable never calls getSortedRowModel), so this accessor's
      // return value is never actually used for sorting — it only needs to exist.
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
