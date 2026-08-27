"use client";

import type { BillListItemDto } from "@bmp/types";
import { Button, DataTable, EmptyState, formatDate } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useBills } from "@/hooks/use-bills";

const columns: ColumnDef<BillListItemDto>[] = [
  {
    accessorKey: "billNumber",
    header: "Bill #",
    cell: ({ row }) => (
      <Link href={`/bills/${row.original.id}`} className="font-medium hover:underline">
        {row.original.billNumber}
      </Link>
    ),
  },
  { accessorKey: "tenderTitle", header: "Tender" },
  { accessorKey: "clientName", header: "Client" },
  {
    accessorKey: "billDate",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.billDate),
  },
  {
    accessorKey: "total",
    header: "Total",
    cell: ({ row }) => row.original.total.toLocaleString(),
  },
];

export default function BillsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const billsQuery = useBills({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
        <p className="text-sm text-muted-foreground">
          Every bill raised against a won tender, across all clients.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={billsQuery.data?.items ?? []}
        isLoading={billsQuery.isLoading}
        pageCount={billsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        emptyState={
          <EmptyState
            icon={Receipt}
            title="No bills yet"
            description="Bills are created from a won tender's detail page."
            action={
              <Button asChild variant="outline">
                <Link href="/tenders">Go to Tenders</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
