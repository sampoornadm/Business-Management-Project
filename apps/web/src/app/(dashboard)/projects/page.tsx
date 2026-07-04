"use client";

import type { ProjectListItemDto } from "@bmp/types";
import { Badge, DataTable } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import Link from "next/link";
import { useState } from "react";

import { useProjects } from "@/hooks/use-projects";

const STATUS_VARIANT: Record<
  ProjectListItemDto["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

const columns: ColumnDef<ProjectListItemDto>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link href={`/projects/${row.original.id}`} className="font-medium hover:underline">
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant={STATUS_VARIANT[row.original.status]}>{row.original.status}</Badge>,
  },
  { accessorKey: "budget", header: "Budget", cell: ({ row }) => row.original.budget.toLocaleString() },
  {
    accessorKey: "startDate",
    header: "Start Date",
    cell: ({ row }) => new Date(row.original.startDate).toLocaleDateString(),
  },
  {
    accessorKey: "endDate",
    header: "Planned End",
    cell: ({ row }) => (row.original.endDate ? new Date(row.original.endDate).toLocaleDateString() : "-"),
  },
];

export default function ProjectsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const projectsQuery = useProjects({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Ongoing work converted from won tenders. Convert a tender from its detail page once it&apos;s WON.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={projectsQuery.data?.items ?? []}
        isLoading={projectsQuery.isLoading}
        pageCount={projectsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
      />
    </div>
  );
}
