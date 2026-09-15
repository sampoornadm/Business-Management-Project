"use client";

import type { BillListItemDto } from "@bmp/types";
import { Button, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import Link from "next/link";

import { downloadFile } from "@/lib/download";

export interface BillColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<BillListItemDto>["cell"];
}

export const BILL_COLUMNS: BillColumnConfig[] = [
  {
    key: "billNumber",
    label: "Bill #",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/bills/${row.original.id}`} className="font-medium hover:underline">
        {row.original.billNumber}
      </Link>
    ),
  },
  {
    key: "tenderTitle",
    label: "Tender",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.tenderTitle,
  },
  {
    key: "clientName",
    label: "Client",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.clientName,
  },
  {
    key: "billDate",
    label: "Date",
    type: "date",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => formatDate(row.original.billDate),
  },
  {
    key: "total",
    label: "Total",
    type: "number",
    // Not a stored column — it's the sum of quantity × rate across BillItem rows, computed in
    // bills.mapper.ts on read. Neither Prisma orderBy nor a where-filter can reach it (see
    // bills.filter-columns.ts's comment), so this stays display-only.
    sortable: false,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.total.toLocaleString(),
  },
  {
    key: "itemCount",
    label: "Items",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: false,
    cell: ({ row }) => row.original.itemCount,
  },
];

export const BILL_DEFAULT_VISIBLE_KEYS = BILL_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const BILL_DEFAULT_ORDER = BILL_COLUMNS.map((c) => c.key);

export function buildBillColumnDefs({
  visibleKeys,
  order,
  onDownloadError,
}: {
  visibleKeys: string[];
  order: string[];
  onDownloadError: (message: string) => void;
}): ColumnDef<BillListItemDto>[] {
  const configByKey = new Map(BILL_COLUMNS.map((c) => [c.key, c]));
  const columns: ColumnDef<BillListItemDto>[] = order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is BillColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));

  columns.push({
    id: "download",
    header: "",
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        title="Download PDF"
        onClick={() => {
          downloadFile(`/bills/${row.original.id}/pdf`, `${row.original.billNumber}.pdf`).catch(
            (error: unknown) => onDownloadError(error instanceof Error ? error.message : "Please try again."),
          );
        }}
      >
        <Download className="h-4 w-4" />
      </Button>
    ),
  });

  return columns;
}
