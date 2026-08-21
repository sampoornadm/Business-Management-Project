"use client";

import { DataTable, EmptyState, Input } from "@bmp/ui";
import type { PaginationState } from "@tanstack/react-table";
import { SearchX, Users2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CreateUserDialog } from "@/components/users/create-user-dialog";
import { userTableColumns } from "@/components/users/user-table-columns";
import { useUsers } from "@/hooks/use-users";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export default function UsersPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const usersQuery = useUsers({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
  });

  const canCreate = hasPermission(roleName, "users:create");
  const pageCount = usersQuery.data ? usersQuery.data.totalPages : 0;
  const hasActiveFilters = Boolean(debouncedSearch);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">Manage staff accounts and role assignments.</p>
        </div>
        {canCreate && <CreateUserDialog />}
      </div>

      <Input
        placeholder="Search by name or email..."
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={userTableColumns}
        data={usersQuery.data?.items ?? []}
        isLoading={usersQuery.isLoading}
        pageCount={pageCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No users match your search"
              description="Try a different name or email."
            />
          ) : (
            <EmptyState
              icon={Users2}
              title="No users yet"
              description="Add staff accounts and assign them roles."
              action={canCreate ? <CreateUserDialog /> : undefined}
            />
          )
        }
      />
    </div>
  );
}
