"use client";

import type { BusinessDto } from "@bmp/types";
import { MSME_CATEGORIES } from "@bmp/types";
import { Badge, formatDateTime, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface BusinessColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<BusinessDto>["cell"];
}

export const BUSINESS_COLUMNS: BusinessColumnConfig[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/businesses/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    key: "code",
    label: "Code",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.code,
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
  {
    key: "isActive",
    label: "Status",
    type: "boolean",
    // Sortable (direction only, no value input needed) but not filterable — packages/ui's
    // AddFilterPopover has no dedicated value-input for FilterColumnType "boolean" (see
    // packages/types/src/business.ts's comment on BUSINESS_FILTER_FIELDS).
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "success" : "secondary"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    key: "city",
    label: "City",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.city ?? "-",
  },
  {
    key: "state",
    label: "State",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.state ?? "-",
  },
  {
    key: "gstNumber",
    label: "GST Number",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.gstNumber ?? "-",
  },
  {
    key: "panNumber",
    label: "PAN Number",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.panNumber ?? "-",
  },
  {
    key: "msmeCategory",
    label: "MSME Category",
    type: "enum",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    enumOptions: MSME_CATEGORIES.map((c) => ({ value: c, label: c })),
    cell: ({ row }) => row.original.msmeCategory ?? "-",
  },
  {
    key: "createdAt",
    label: "Created",
    type: "date",
    sortable: true,
    filterable: true,
    defaultVisible: false,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
];

export const BUSINESS_DEFAULT_VISIBLE_KEYS = BUSINESS_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);
export const BUSINESS_DEFAULT_ORDER = BUSINESS_COLUMNS.map((c) => c.key);

export function buildBusinessColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<BusinessDto>[] {
  const configByKey = new Map(BUSINESS_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is BusinessColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      // See tender-column-registry.tsx's comment: TanStack's column.getCanSort() requires a
      // truthy accessorFn regardless of enableSorting. Sorting is fully server-driven here too.
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
