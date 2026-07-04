import type { AuditLogDto, PaginatedResult } from "@bmp/types";

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
}
