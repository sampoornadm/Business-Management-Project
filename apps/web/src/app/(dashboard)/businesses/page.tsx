"use client";

import { Badge, Button, DataTable, Input } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Briefcase } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Business } from "@/hooks/use-businesses";
import { useBusinesses } from "@/hooks/use-businesses";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const columns: ColumnDef<Business>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/businesses/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
  },
  {
    accessorKey: "tenderCount",
    header: "Tenders",
  },
  {
    accessorKey: "isActive",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "default" : "secondary"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

export default function BusinessesPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const businessesQuery = useBusinesses({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
  });

  const canCreate = hasPermission(roleName, "businesses:create");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Businesses</h1>
          <p className="text-sm text-muted-foreground">
            Legal entities that tenders, projects, and finance records are scoped under.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/businesses/new">
              <Briefcase className="mr-2 h-4 w-4" /> Add Business
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
        data={businessesQuery.data?.items ?? []}
        isLoading={businessesQuery.isLoading}
        pageCount={businessesQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
