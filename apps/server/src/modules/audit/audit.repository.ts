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
  /** Readable entity code; resolved by AuditService.log when omitted. */
  entityCode?: string | null;
  /** Owning business; resolved with entityCode when omitted. Null = global (visible to all admins). */
  businessId?: string | null;
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
  /** Set for non-Super-Admin viewers: only this business's rows plus global (null-business) rows. */
  visibleBusinessId?: string;
}

const auditLogWithActor = {
  include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
} satisfies Prisma.AuditLogDefaultArgs;

export type AuditLogWithActor = Prisma.AuditLogGetPayload<typeof auditLogWithActor>;

export interface IAuditRepository {
  create(data: CreateAuditLogData): Promise<void>;
  /** Code + business from the most recent row that recorded a code for this entity, if any. */
  findLatestEntityRef(entityType: string, entityId: string): Promise<{ code: string | null; businessId: string | null } | null>;
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
        entityCode: data.entityCode ?? null,
        businessId: data.businessId ?? null,
        metadata: data.metadata,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
      },
    });
  }

  async findLatestEntityRef(
    entityType: string,
    entityId: string,
  ): Promise<{ code: string | null; businessId: string | null } | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { entityType, entityId, entityCode: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { entityCode: true, businessId: true },
    });
    return row ? { code: row.entityCode, businessId: row.businessId } : null;
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
      ...(filters.visibleBusinessId
        ? { OR: [{ businessId: filters.visibleBusinessId }, { businessId: null }] }
        : {}),
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
