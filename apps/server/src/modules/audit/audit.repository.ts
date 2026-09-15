import type { Prisma, PrismaClient } from "@bmp/database";
import type { AuditLogSortField, FilterCondition } from "@bmp/types";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { buildPrismaFilterWhere } from "../../shared/utils/filtering.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

import { AUDIT_LOG_FILTER_COLUMNS, AUDIT_LOG_SORT_COLUMNS } from "./audit.filter-columns.js";

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
  filters?: FilterCondition[];
  sortBy?: AuditLogSortField;
  sortDir?: "asc" | "desc";
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
    const baseWhere: Prisma.AuditLogWhereInput = {
      entityType: filters.entityType,
      entityId: filters.entityId,
      actorId: filters.actorId,
      action: filters.action,
    };

    const chipWhere = buildPrismaFilterWhere(
      filters.filters ?? [],
      AUDIT_LOG_FILTER_COLUMNS,
    ) as Prisma.AuditLogWhereInput;
    const where: Prisma.AuditLogWhereInput =
      Object.keys(chipWhere).length > 0 ? { AND: [baseWhere, chipWhere] } : baseWhere;

    const orderBy = filters.sortBy
      ? AUDIT_LOG_SORT_COLUMNS[filters.sortBy](filters.sortDir ?? "asc")
      : ({ createdAt: "desc" } as const);

    const [items, totalItems] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        ...auditLogWithActor,
        orderBy,
        ...toSkipTake(pagination),
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, totalItems };
  }
}
