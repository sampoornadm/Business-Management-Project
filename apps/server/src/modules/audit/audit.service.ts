import type { AuditLogDto, PaginatedResult } from "@bmp/types";

import { EXPORT_MAX_ROWS } from "../../config/constants.js";
import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";

import { toAuditLogDto } from "./audit.mapper.js";
import type { AuditLogFilters, CreateAuditLogData, IAuditRepository } from "./audit.repository.js";
import type { EntityCodeResolver } from "./entity-code.js";

export class AuditService {
  constructor(
    private readonly auditRepository: IAuditRepository,
    private readonly resolveEntityCode: EntityCodeResolver,
  ) {}

  /**
   * Records an event. The entity's readable code and owning business are looked up here unless the
   * caller passes them (the business decides which viewers can see the row).
   */
  async log(data: CreateAuditLogData): Promise<void> {
    const needsLookup = data.entityCode === undefined || data.businessId === undefined;
    const found = needsLookup ? await this.lookupEntityRef(data) : null;
    await this.auditRepository.create({
      ...data,
      entityCode: data.entityCode !== undefined ? data.entityCode : (found?.code ?? null),
      businessId: data.businessId !== undefined ? data.businessId : (found?.businessId ?? null),
    });
  }

  // The entity as it is now; once it is gone (most *_DELETED events log after the delete), what an
  // earlier row recorded for it. A failed lookup must never cost the event itself — stored as null.
  private async lookupEntityRef(data: CreateAuditLogData) {
    if (!data.entityType || !data.entityId) return null;
    try {
      return (
        (await this.resolveEntityCode(data.entityType, data.entityId)) ??
        (await this.auditRepository.findLatestEntityRef(data.entityType, data.entityId))
      );
    } catch {
      return null;
    }
  }

  async list(
    pagination: PaginationParams,
    filters: AuditLogFilters,
  ): Promise<PaginatedResult<AuditLogDto>> {
    const { items, totalItems } = await this.auditRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toAuditLogDto), totalItems, pagination);
  }

  async exportAuditLogs(
    filters: AuditLogFilters,
    scope: "view" | "all",
    viewPagination: PaginationParams,
  ): Promise<AuditLogDto[]> {
    const pagination = scope === "view" ? viewPagination : { page: 1, pageSize: EXPORT_MAX_ROWS };
    const { items, totalItems } = await this.auditRepository.findMany(pagination, filters);
    if (scope === "all" && totalItems > EXPORT_MAX_ROWS) {
      throw new BadRequestError(
        `Narrow your filters — more than ${EXPORT_MAX_ROWS} rows match your current filters.`,
      );
    }
    return items.map(toAuditLogDto);
  }
}
