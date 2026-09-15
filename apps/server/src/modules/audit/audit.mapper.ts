import type { AuditLogDto } from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { AuditLogWithActor } from "./audit.repository.js";

export function toAuditLogDto(entity: AuditLogWithActor): AuditLogDto {
  return {
    id: entity.id,
    actor: entity.actor
      ? {
          id: entity.actor.id,
          firstName: entity.actor.firstName,
          lastName: entity.actor.lastName,
          email: entity.actor.email,
        }
      : null,
    action: entity.action,
    entityType: entity.entityType,
    entityId: entity.entityId,
    metadata: (entity.metadata as Record<string, unknown> | null) ?? null,
    ipAddress: entity.ipAddress,
    createdAt: entity.createdAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/audit-log/audit-log-column-registry.tsx's
// AUDIT_LOG_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file. Key "actorId" holds a friendly
// display name here (not the raw id) — same convention as tenders' "clientName" export column.
const AUDIT_LOG_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "actorId", header: "Actor" },
  { key: "action", header: "Action" },
  { key: "entityType", header: "Entity Type" },
  { key: "entityId", header: "Entity ID" },
  { key: "ipAddress", header: "IP Address" },
  { key: "createdAt", header: "When" },
];

function auditLogExportRow(log: AuditLogDto): Record<string, string | number> {
  return {
    actorId: log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : "System",
    action: log.action,
    entityType: log.entityType ?? "",
    entityId: log.entityId ?? "",
    ipAddress: log.ipAddress ?? "",
    createdAt: log.createdAt.slice(0, 10),
  };
}

export function buildAuditLogExportTable(logs: AuditLogDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(AUDIT_LOG_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = logs.map((log) => {
    const fullRow = auditLogExportRow(log);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Audit Log", columns, rows };
}

export const AUDIT_LOG_EXPORT_COLUMN_KEYS = AUDIT_LOG_EXPORT_COLUMNS.map((column) => column.key);
