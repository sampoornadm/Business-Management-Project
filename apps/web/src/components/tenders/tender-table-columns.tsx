"use client";

import type { TenderListItemDto } from "@bmp/types";
import { TENDER_STATUS_LABELS } from "@bmp/types";
import { Badge, formatDate } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";

export function buildTenderTableColumns({
  canGenerateDocument,
}: {
  canGenerateDocument: boolean;
}): ColumnDef<TenderListItemDto>[] {
  const columns: ColumnDef<TenderListItemDto>[] = [
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
      cell: ({ row }) => formatDate(row.original.submissionDate),
    },
    {
      accessorKey: "assigneeCount",
      header: "Assignees",
    },
  ];

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
