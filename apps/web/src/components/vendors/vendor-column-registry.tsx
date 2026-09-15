"use client";

import type { VendorListItemDto } from "@bmp/types";
import { VENDOR_CATEGORIES } from "@bmp/types";
import { Badge, SortableHeader, StarRating } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export const VENDOR_CATEGORY_LABELS: Record<VendorListItemDto["category"], string> = {
  MATERIAL_SUPPLIER: "Material Supplier",
  SERVICE_PROVIDER: "Service Provider",
  SUBCONTRACTOR: "Subcontractor",
  EQUIPMENT_RENTAL: "Equipment Rental",
};

export interface VendorColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<VendorListItemDto>["cell"];
}

export const VENDOR_COLUMNS: VendorColumnConfig[] = [
  {
    key: "name",
    label: "Name",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/vendors/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    key: "category",
    label: "Category",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: VENDOR_CATEGORIES.map((c) => ({ value: c, label: VENDOR_CATEGORY_LABELS[c] })),
    cell: ({ row }) => <Badge variant="outline">{VENDOR_CATEGORY_LABELS[row.original.category]}</Badge>,
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
    key: "isActive",
    label: "Status",
    // Not filterable: the shared AddFilterPopover renders a "boolean"-typed column as a free-text
    // input for its only operator ("is") — no true/false picker — and filtering.ts's coerceScalar
    // doesn't coerce that text back to a real Prisma boolean either. Sorting has no such gap
    // (orderBy works on any native column type), so this stays sortable-only.
    type: "boolean",
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
    key: "averageRating",
    label: "Rating",
    // Not sortable: averageRating is a derived average over VendorRating rows, and Prisma's
    // relation-aggregate `orderBy` only supports `_count` for to-many relations, not `_avg` — no
    // clean way to sort by it without a raw query or a denormalized column.
    type: "number",
    sortable: false,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) =>
      row.original.averageRating !== null ? (
        <div className="space-y-0.5">
          <StarRating value={row.original.averageRating} size="sm" />
          <p className="text-xs text-muted-foreground">
            {row.original.averageRating} average ({row.original.totalRatings} review
            {row.original.totalRatings === 1 ? "" : "s"})
          </p>
        </div>
      ) : (
        "-"
      ),
  },
];

export const VENDOR_DEFAULT_VISIBLE_KEYS = VENDOR_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const VENDOR_DEFAULT_ORDER = VENDOR_COLUMNS.map((c) => c.key);

export function buildVendorColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<VendorListItemDto>[] {
  const configByKey = new Map(VENDOR_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is VendorColumnConfig => Boolean(config))
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
