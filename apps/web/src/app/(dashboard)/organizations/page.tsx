"use client";

import type { OrganizationListItemDto } from "@bmp/types";
import { Badge, Button, DataTable, Input } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useOrganizations } from "@/hooks/use-organizations";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const columns: ColumnDef<OrganizationListItemDto>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/organizations/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant={row.original.type === "GOVERNMENT" ? "secondary" : "outline"}>
        {row.original.type === "GOVERNMENT" ? "Government" : "Private"}
      </Badge>
    ),
  },
  {
    accessorKey: "city",
    header: "Location",
    cell: ({ row }) => [row.original.city, row.original.state].filter(Boolean).join(", ") || "-",
  },
  {
    accessorKey: "tenderCount",
    header: "Tenders",
  },
];

export default function OrganizationsPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const organizationsQuery = useOrganizations({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
  });

  const canCreate = hasPermission(roleName, "organizations:create");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Government bodies and private companies that tenders are issued by.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/organizations/new">
              <Building2 className="mr-2 h-4 w-4" /> Add Organization
            </Link>
          </Button>
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
        data={organizationsQuery.data?.items ?? []}
        isLoading={organizationsQuery.isLoading}
        pageCount={organizationsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
