"use client";

import type { PurchaseOrderListItemDto } from "@bmp/types";
import { Badge, Button, DataTable, EmptyState, formatDate } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { FilePlus2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

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

const columns: ColumnDef<PurchaseOrderListItemDto>[] = [
  {
    accessorKey: "poNumber",
    header: "PO Number",
    cell: ({ row }) => (
      <Link href={`/purchase-orders/${row.original.id}`} className="font-medium hover:underline">
        {row.original.poNumber}
      </Link>
    ),
  },
  { accessorKey: "vendor.name", header: "Vendor", cell: ({ row }) => row.original.vendor.name },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
  },
  {
    accessorKey: "totalAmount",
    header: "Total",
    cell: ({ row }) => row.original.totalAmount.toLocaleString(),
  },
  {
    accessorKey: "expectedDeliveryDate",
    header: "Expected Delivery",
    cell: ({ row }) =>
      row.original.expectedDeliveryDate
        ? formatDate(row.original.expectedDeliveryDate)
        : "-",
  },
];

export default function PurchaseOrdersPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const poQuery = usePurchaseOrders({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const canCreate = hasPermission(roleName, "purchase_orders:create");

  const createPoButton = (
    <Button asChild>
      <Link href="/purchase-orders/new">
        <FilePlus2 className="mr-2 h-4 w-4" /> Create Purchase Order
      </Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">
            Track orders placed with vendors and their delivery status.
          </p>
        </div>
        {canCreate && createPoButton}
      </div>

      <DataTable
        columns={columns}
        data={poQuery.data?.items ?? []}
        isLoading={poQuery.isLoading}
        pageCount={poQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        emptyState={
          <EmptyState
            icon={FilePlus2}
            title="No purchase orders yet"
            description="Create a purchase order to start tracking deliveries from a vendor."
            action={canCreate ? createPoButton : undefined}
          />
        }
      />
    </div>
  );
}
