import type { FilterCondition } from "./filtering.js";

export interface AuditLogDto {
  id: string;
  actor: { id: string; firstName: string; lastName: string; email: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

// entityId/ipAddress are free text; actorId/action/entityType are treated as enums (see the
// frontend column registry's static option lists) even though the DB columns are plain strings —
// filterConditionSchema's `value` stays unconstrained either way, so a value outside those static
// lists is simply never offered in the dropdown, never rejected server-side.
export const AUDIT_LOG_FILTER_FIELDS = ["actorId", "action", "entityType", "entityId", "ipAddress"] as const;
export type AuditLogFilterField = (typeof AUDIT_LOG_FILTER_FIELDS)[number];

// actorId is deliberately not sortable — sorting a relation by firstName alone (Prisma can't sort
// by a concatenated "full name") is more misleading than useful, so it's filterable (exact id
// match against a name picked from a dropdown) but not offered as a sort column.
export const AUDIT_LOG_SORT_FIELDS = ["action", "entityType", "createdAt"] as const;
export type AuditLogSortField = (typeof AUDIT_LOG_SORT_FIELDS)[number];

export interface ListAuditLogsQuery {
  page?: number;
  pageSize?: number;
  entityType?: string;
  actorId?: string;
  filters?: FilterCondition[];
  sortBy?: AuditLogSortField;
  sortDir?: "asc" | "desc";
}
