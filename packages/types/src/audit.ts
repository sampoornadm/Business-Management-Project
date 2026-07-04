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
