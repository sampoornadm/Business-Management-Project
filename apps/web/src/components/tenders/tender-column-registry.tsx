"use client";

import type { TenderListItemDto } from "@bmp/types";
import { TENDER_PRIORITIES, TENDER_STATUS_LABELS, TENDER_STATUSES } from "@bmp/types";
import { Badge, formatDate, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";

export interface TenderColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<TenderListItemDto>["cell"];
}

export const TENDER_COLUMNS: TenderColumnConfig[] = [
  {
    key: "tenderNumber",
    label: "Tender #",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => (
      <Link href={`/tenders/${row.original.id}`} className="font-medium hover:underline">
        {row.original.tenderNumber}
      </Link>
    ),
  },
  {
    key: "title",
    label: "Title",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span>,
  },
  {
    key: "clientName",
    label: "Client",
    type: "text",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => row.original.client.name,
  },
  {
    key: "status",
    label: "Status",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: TENDER_STATUSES.map((s) => ({ value: s, label: TENDER_STATUS_LABELS[s] })),
    cell: ({ row }) => (
      <Badge variant={tenderStatusBadgeVariant(row.original.status)}>
        {TENDER_STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
  {
    key: "priority",
    label: "Priority",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: TENDER_PRIORITIES.map((p) => ({ value: p, label: p })),
    cell: ({ row }) => (
      <Badge variant={tenderPriorityBadgeVariant(row.original.priority)}>{row.original.priority}</Badge>
    ),
  },
  {
    key: "department",
    label: "Department",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.department ?? "-",
  },
  {
    key: "submissionDate",
    label: "Submission Date",
    type: "date",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) => formatDate(row.original.submissionDate),
  },
  {
    key: "assigneeCount",
    label: "Assignees",
    type: "number",
    sortable: true,
    filterable: false,
    defaultVisible: true,
    cell: ({ row }) => row.original.assigneeCount,
  },
];

export const TENDER_DEFAULT_VISIBLE_KEYS = TENDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key);
export const TENDER_DEFAULT_ORDER = TENDER_COLUMNS.map((c) => c.key);

export function buildTenderColumnDefs({
  visibleKeys,
  order,
  canGenerateDocument,
}: {
  visibleKeys: string[];
  order: string[];
  canGenerateDocument: boolean;
}): ColumnDef<TenderListItemDto>[] {
  const configByKey = new Map(TENDER_COLUMNS.map((c) => [c.key, c]));
  const columns: ColumnDef<TenderListItemDto>[] = order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is TenderColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));

  if (canGenerateDocument) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TenderDownloadMenu
            tenderId={row.original.id}
            tenderNumber={row.original.tenderNumber}
            size="sm"
            iconOnly
          />
        </div>
      ),
    });
  }

  return columns;
}
