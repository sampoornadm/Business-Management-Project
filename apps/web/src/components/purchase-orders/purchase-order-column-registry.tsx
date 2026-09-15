"use client";

import type { PurchaseOrderListItemDto } from "@bmp/types";
import { PURCHASE_ORDER_STATUSES } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface PurchaseOrderColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<PurchaseOrderListItemDto>["cell"];
}

const STATUS_VARIANT: Record<
  PurchaseOrderListItemDto["status"],
  "success" | "secondary" | "outline" | "destructive"
> = {
  DRAFT: "outline",
  ISSUED: "secondary",
  PARTIALLY_RECEIVED: "secondary",
  RECEIVED: "success",
  CANCELLED: "destructive",
};

export const PURCHASE_ORDER_COLUMNS: PurchaseOrderColumnConfig[] = [
  {
    key: "poNumber",
    label: "PO Number",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/purchase-orders/${row.original.id}`} className="font-medium hover:underline">
        {row.original.poNumber}
      </Link>
    ),
  },
  {
    key: "vendorName",
    label: "Vendor",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.vendor.name,
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: PURCHASE_ORDER_STATUSES.map((s) => ({ value: s, label: s })),
    cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
  },
  {
    key: "totalAmount",
    label: "Total",
    type: "number",
    // totalAmount is a computed sum of item amounts, not a stored column — Prisma can't
    // filter/sort on a relation-sum aggregate server-side (see purchase-orders.filter-columns.ts).
    sortable: false,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.totalAmount.toLocaleString(),
  },
  {
    key: "expectedDeliveryDate",
    label: "Expected Delivery",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) =>
      row.original.expectedDeliveryDate ? formatDate(row.original.expectedDeliveryDate) : "-",
  },
];

export const PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS = PURCHASE_ORDER_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.key);
export const PURCHASE_ORDER_DEFAULT_ORDER = PURCHASE_ORDER_COLUMNS.map((c) => c.key);

export function buildPurchaseOrderColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<PurchaseOrderListItemDto>[] {
  const configByKey = new Map(PURCHASE_ORDER_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is PurchaseOrderColumnConfig => Boolean(config))
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
