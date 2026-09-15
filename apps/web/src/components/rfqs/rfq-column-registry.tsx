"use client";

import { RFQ_STATUSES, type RfqListItemDto } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface RfqColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<RfqListItemDto>["cell"];
}

const RFQ_STATUS_VARIANT: Record<
  RfqListItemDto["status"],
  "success" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  SENT: "secondary",
  CLOSED: "success",
  CANCELLED: "destructive",
};

export const RFQ_COLUMNS: RfqColumnConfig[] = [
  {
    key: "title",
    label: "Title",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/rfqs/${row.original.id}`} className="font-medium hover:underline">
        {row.original.title}
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
    enumOptions: RFQ_STATUSES.map((s) => ({ value: s, label: s })),
    cell: ({ row }) => (
      <Badge variant={RFQ_STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>
    ),
  },
  {
    key: "dueDate",
    label: "Due Date",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => (row.original.dueDate ? formatDate(row.original.dueDate) : "-"),
  },
  {
    key: "itemCount",
    label: "Items",
    type: "number",
    // Prisma can orderBy a relation's _count but has no `where` filter for it — same
    // reasoning as tender-column-registry.tsx's assigneeCount.
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.itemCount,
  },
  {
    key: "vendorCount",
    label: "Vendors Invited",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.vendorCount,
  },
];

export const RFQ_DEFAULT_VISIBLE_KEYS = RFQ_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const RFQ_DEFAULT_ORDER = RFQ_COLUMNS.map((c) => c.key);

export function buildRfqColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<RfqListItemDto>[] {
  const configByKey = new Map(RFQ_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is RfqColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      // See tender-column-registry.tsx's comment: sorting is fully server-driven, but
      // column.getCanSort() still requires a truthy accessorFn to enable the click handler.
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
