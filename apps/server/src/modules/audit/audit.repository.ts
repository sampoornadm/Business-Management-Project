import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

export interface CreateAuditLogData {
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
}

const auditLogWithActor = {
  include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
} satisfies Prisma.AuditLogDefaultArgs;

export type AuditLogWithActor = Prisma.AuditLogGetPayload<typeof auditLogWithActor>;

export interface IAuditRepository {
  create(data: CreateAuditLogData): Promise<void>;
  findMany(
    pagination: PaginationParams,
    filters: AuditLogFilters,
  ): Promise<{ items: AuditLogWithActor[]; totalItems: number }>;
}

export class AuditRepository implements IAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateAuditLogData): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: data.actorId ?? null,
        action: data.action,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        metadata: data.metadata,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async findMany(
    pagination: PaginationParams,
    filters: AuditLogFilters,
  ): Promise<{ items: AuditLogWithActor[]; totalItems: number }> {
    const where: Prisma.AuditLogWhereInput = {
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorId: filters.actorId,
      action: filters.action,
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        ...auditLogWithActor,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, totalItems };
  }
}
