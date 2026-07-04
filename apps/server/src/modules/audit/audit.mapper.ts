import type { AuditLogDto } from "@bmp/types";

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
