"use client";

import type { OrganizationListItemDto } from "@bmp/types";
import { ORGANIZATION_TYPES } from "@bmp/types";
import { Badge, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

const ORGANIZATION_TYPE_LABELS: Record<(typeof ORGANIZATION_TYPES)[number], string> = {
  GOVERNMENT: "Government",
  PRIVATE: "Private",
};

export interface OrganizationColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<OrganizationListItemDto>["cell"];
}

export const ORGANIZATION_COLUMNS: OrganizationColumnConfig[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/organizations/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    key: "type",
    label: "Type",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: ORGANIZATION_TYPES.map((t) => ({ value: t, label: ORGANIZATION_TYPE_LABELS[t] })),
    cell: ({ row }) => (
      <Badge variant={row.original.type === "GOVERNMENT" ? "secondary" : "outline"}>
        {ORGANIZATION_TYPE_LABELS[row.original.type]}
      </Badge>
    ),
  },
  {
    key: "city",
    label: "City",
    type: "text",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.city ?? "-",
  },
  {
    key: "state",
    label: "State",
    type: "text",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.state ?? "-",
  },
  {
    key: "tenderCount",
    label: "Tenders",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.tenderCount,
  },
];

export const ORGANIZATION_DEFAULT_VISIBLE_KEYS = ORGANIZATION_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);
export const ORGANIZATION_DEFAULT_ORDER = ORGANIZATION_COLUMNS.map((c) => c.key);

export function buildOrganizationColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<OrganizationListItemDto>[] {
  const configByKey = new Map(ORGANIZATION_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is OrganizationColumnConfig => Boolean(config))
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
