import type { Prisma } from "@bmp/database";
import type { AuditLogFilterField, AuditLogSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const AUDIT_LOG_FILTER_COLUMNS: Record<AuditLogFilterField, FilterableColumnDescriptor> = {
  // Type "enum" (not "text") so the frontend's "is"/"is_not"/"any_of" operators are offered — the
  // filter builder shows actors as a pick-list (derived from actors currently in view, mirroring
  // tenders' clientName trick) but still matches by exact actorId here, a real indexed column.
  actorId: { type: "enum", prismaPath: ["actorId"], nullable: true },
  action: { type: "enum", prismaPath: ["action"] },
  entityType: { type: "enum", prismaPath: ["entityType"], nullable: true },
  entityId: { type: "text", prismaPath: ["entityId"], nullable: true },
  ipAddress: { type: "text", prismaPath: ["ipAddress"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.AuditLogOrderByWithRelationInput;

export const AUDIT_LOG_SORT_COLUMNS: Record<AuditLogSortField, OrderByBuilder> = {
  action: (dir) => ({ action: dir }),
  entityType: (dir) => ({ entityType: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};
