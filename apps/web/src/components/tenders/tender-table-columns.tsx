"use client";

import type { TenderListItemDto } from "@bmp/types";
import { TENDER_STATUS_LABELS } from "@bmp/types";
import { Badge } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";

export const tenderTableColumns: ColumnDef<TenderListItemDto>[] = [
  {
    accessorKey: "tenderNumber",
    header: "Tender #",
    cell: ({ row }) => (
      <Link href={`/tenders/${row.original.id}`} className="font-medium hover:underline">
        {row.original.tenderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span>,
  },
  {
    accessorKey: "client",
    header: "Client",
    cell: ({ row }) => row.original.client.name,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={tenderStatusBadgeVariant(row.original.status)}>
        {TENDER_STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => (
      <Badge variant={tenderPriorityBadgeVariant(row.original.priority)}>{row.original.priority}</Badge>
    ),
  },
  {
    accessorKey: "submissionDate",
    header: "Submission Date",
    cell: ({ row }) => new Date(row.original.submissionDate).toLocaleDateString(),
  },
  {
    accessorKey: "assigneeCount",
    header: "Assignees",
  },
];
