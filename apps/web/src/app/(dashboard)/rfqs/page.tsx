"use client";

import type { RfqListItemDto } from "@bmp/types";
import { Badge, Button, DataTable } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useRfqs } from "@/hooks/use-rfq";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const STATUS_VARIANT: Record<RfqListItemDto["status"], "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  CLOSED: "secondary",
  AWARDED: "default",
  CANCELLED: "destructive",
};

const columns: ColumnDef<RfqListItemDto>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => (
      <Link href={`/rfqs/${row.original.id}`} className="font-medium hover:underline">
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
  },
  { accessorKey: "itemCount", header: "Items" },
  { accessorKey: "vendorCount", header: "Vendors Invited" },
  {
    accessorKey: "dueDate",
    header: "Due Date",
    cell: ({ row }) => (row.original.dueDate ? new Date(row.original.dueDate).toLocaleDateString() : "-"),
  },
];

export default function RfqsPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const rfqsQuery = useRfqs({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const canCreate = hasPermission(roleName, "rfq:create");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">RFQs</h1>
          <p className="text-sm text-muted-foreground">
            Request quotations from vendors and compare their rates.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/rfqs/new">
              <FilePlus2 className="mr-2 h-4 w-4" /> Create RFQ
            </Link>
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={rfqsQuery.data?.items ?? []}
        isLoading={rfqsQuery.isLoading}
        pageCount={rfqsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
