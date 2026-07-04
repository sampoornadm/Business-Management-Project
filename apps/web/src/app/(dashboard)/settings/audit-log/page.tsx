"use client";

import { Badge, Card, CardContent, DataTable } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useState } from "react";

import { useAuditLogs } from "@/hooks/use-audit-logs";

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  createdAt: string;
}

const columns: ColumnDef<AuditRow>[] = [
  { accessorKey: "actor", header: "Actor" },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
  },
  { accessorKey: "entity", header: "Entity" },
  {
    accessorKey: "createdAt",
    header: "When",
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
  },
];

export default function AuditLogPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const auditQuery = useAuditLogs({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });

  const rows: AuditRow[] =
    auditQuery.data?.items.map((log) => ({
      id: log.id,
      actor: log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : "System",
      action: log.action,
      entity: [log.entityType, log.entityId].filter(Boolean).join(" · ") || "-",
      createdAt: log.createdAt,
    })) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          A record of security and business events across the platform.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={rows}
            isLoading={auditQuery.isLoading}
            pageCount={auditQuery.data?.totalPages ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
          />
        </CardContent>
      </Card>
    </div>
  );
}
