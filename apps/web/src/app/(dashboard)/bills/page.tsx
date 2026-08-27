"use client";

import type { BillListItemDto } from "@bmp/types";
import { Button, DataTable, EmptyState, formatDate, useToast } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Download, Receipt, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useBills } from "@/hooks/use-bills";
import { downloadFile } from "@/lib/download";

function buildColumns(onDownloadError: (message: string) => void): ColumnDef<BillListItemDto>[] {
  return [
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
    {
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
    },
  ];
}

export default function BillsPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const tenderId = searchParams.get("tenderId") ?? undefined;
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const billsQuery = useBills({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize, tenderId });
  const tenderTitle = billsQuery.data?.items[0]?.tenderTitle;
  const columns = useMemo(
    () =>
      buildColumns((message) =>
        toast({ variant: "destructive", title: "Could not download PDF", description: message }),
      ),
    [toast],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">
            {tenderId
              ? `Filtered to ${tenderTitle ?? "this tender"}.`
              : "Every bill raised against a won tender, across all clients."}
          </p>
        </div>
        {tenderId && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/bills">
              <X className="mr-2 h-4 w-4" /> Clear filter
            </Link>
          </Button>
        )}
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
            description={
              tenderId
                ? "This tender has no bills yet."
                : "Bills are created from a won tender's detail page."
            }
            action={
              tenderId ? undefined : (
                <Button asChild variant="outline">
                  <Link href="/tenders">Go to Tenders</Link>
                </Button>
              )
            }
          />
        }
      />
    </div>
  );
}
