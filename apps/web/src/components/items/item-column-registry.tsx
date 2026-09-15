"use client";

import type { ItemListEntryDto } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

export interface ItemColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<ItemListEntryDto>["cell"];
}

function rateRange(entry: ItemListEntryDto): string {
  if (entry.minRate === null || entry.maxRate === null) return "-";
  return entry.minRate === entry.maxRate
    ? entry.minRate.toLocaleString()
    : `${entry.minRate.toLocaleString()} – ${entry.maxRate.toLocaleString()}`;
}

function CategoryCell({ entry }: { entry: ItemListEntryDto }) {
  if (!entry.categoryPath) return <span className="text-muted-foreground">Unclassified</span>;
  if (entry.confirmed) return <span>{entry.categoryPath}</span>;
  if (entry.needsReview) {
    return (
      <Badge
        variant="destructive"
        className="gap-1"
        title="AI classified this with low similarity to any known item — please double-check."
      >
        <AlertTriangle className="h-3 w-3" /> AI: {entry.categoryPath}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      title={entry.aiConfidence !== null ? `AI confidence ${Math.round(entry.aiConfidence * 100)}%` : undefined}
    >
      AI: {entry.categoryPath}
    </Badge>
  );
}

export const ITEM_COLUMNS: ItemColumnConfig[] = [
  {
    key: "canonicalName",
    label: "Item",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/items/${row.original.id}`} className="font-medium hover:underline">
        {row.original.canonicalName}
      </Link>
    ),
  },
  {
    key: "categoryPath",
    label: "Category",
    // Placeholder "text" here — items/page.tsx overrides this to "enum" at runtime with
    // enumOptions from useCategoryLeaves() (category ids labeled by path), same pattern as
    // Tenders' clientName column: the option list isn't statically known ahead of time.
    type: "text",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => <CategoryCell entry={row.original} />,
  },
  {
    key: "unit",
    label: "Unit",
    type: "text",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.unit ?? "-",
  },
  {
    key: "quoteCount",
    label: "Quotes",
    type: "number",
    sortable: true,
    // Aggregated in-memory from RfqQuote rows (not a Prisma column on Item) — sortable but not
    // pushed down as a filter chip, same as Tenders' assigneeCount.
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => <span className="tabular-nums">{row.original.quoteCount}</span>,
  },
  {
    key: "vendorCount",
    label: "Vendors",
    type: "number",
    sortable: false,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => <span className="tabular-nums">{row.original.vendorCount}</span>,
  },
  {
    key: "minRate",
    label: "Rate Range",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => <span className="tabular-nums">{rateRange(row.original)}</span>,
  },
  {
    key: "avgRate",
    label: "Avg Rate",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.avgRate?.toLocaleString() ?? "-"}</span>
    ),
  },
  {
    key: "lastQuotedAt",
    label: "Last Quoted",
    type: "date",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => (row.original.lastQuotedAt ? formatDate(row.original.lastQuotedAt) : "-"),
  },
];

export const ITEM_DEFAULT_VISIBLE_KEYS = ITEM_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const ITEM_DEFAULT_ORDER = ITEM_COLUMNS.map((c) => c.key);

export function buildItemColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<ItemListEntryDto>[] {
  const configByKey = new Map(ITEM_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is ItemColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      // See tender-column-registry.tsx's identical comment: TanStack needs a truthy accessorFn
      // for getCanSort() even though sorting is fully server-driven.
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
