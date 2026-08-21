// Notifications carry a generic entityType/entityId pair (same convention as
// Attachment/AuditLog — see CLAUDE.md). Only "Tender" is produced today
// (grep apps/server/src/modules/**/*.service.ts for notificationsService.create),
// but the switch stays open for whatever entity type comes next.
export function notificationHref(entityType: string | null, entityId: string | null): string | undefined {
  if (!entityType || !entityId) return undefined;
  switch (entityType) {
    case "Tender":
      return `/tenders/${entityId}`;
    default:
      return undefined;
  }
}
