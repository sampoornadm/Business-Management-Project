"use client";

import type { VendorListItemDto } from "@bmp/types";
import { Badge, Button, DataTable, Input } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Star, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ImportItemTagsDialog } from "@/components/vendors/import-item-tags-dialog";
import { useVendors } from "@/hooks/use-vendors";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const CATEGORY_LABELS: Record<VendorListItemDto["category"], string> = {
  MATERIAL_SUPPLIER: "Material Supplier",
  SERVICE_PROVIDER: "Service Provider",
  SUBCONTRACTOR: "Subcontractor",
  EQUIPMENT_RENTAL: "Equipment Rental",
};

const columns: ColumnDef<VendorListItemDto>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/vendors/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => <Badge variant="outline">{CATEGORY_LABELS[row.original.category]}</Badge>,
  },
  {
    accessorKey: "city",
    header: "Location",
    cell: ({ row }) => [row.original.city, row.original.state].filter(Boolean).join(", ") || "-",
  },
  {
    accessorKey: "averageRating",
    header: "Rating",
    cell: ({ row }) =>
      row.original.averageRating !== null ? (
        <span className="flex items-center gap-1">
          <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> {row.original.averageRating}
        </span>
      ) : (
        "-"
      ),
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => <Badge variant={row.original.isActive ? "default" : "secondary"}>{row.original.isActive ? "Active" : "Inactive"}</Badge>,
  },
];

export default function VendorsPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const vendorsQuery = useVendors({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
  });

  const canCreate = hasPermission(roleName, "vendors:create");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Suppliers, service providers, and subcontractors used across procurement.
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <ImportItemTagsDialog
              trigger={
                <Button variant="outline">
                  <Upload className="mr-2 h-4 w-4" /> Import item tags
                </Button>
              }
            />
            <Button asChild>
              <Link href="/vendors/new">
                <UserPlus className="mr-2 h-4 w-4" /> Add Vendor
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Input
        placeholder="Search by name..."
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={columns}
        data={vendorsQuery.data?.items ?? []}
        isLoading={vendorsQuery.isLoading}
        pageCount={vendorsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
