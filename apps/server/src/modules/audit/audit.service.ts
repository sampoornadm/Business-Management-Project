import type { AuditLogDto, PaginatedResult } from "@bmp/types";

import { EXPORT_MAX_ROWS } from "../../config/constants.js";
import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";

import { toAuditLogDto } from "./audit.mapper.js";
import type { AuditLogFilters, CreateAuditLogData, IAuditRepository } from "./audit.repository.js";

export class AuditService {
  constructor(private readonly auditRepository: IAuditRepository) {}

  async log(data: CreateAuditLogData): Promise<void> {
    await this.auditRepository.create(data);
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
