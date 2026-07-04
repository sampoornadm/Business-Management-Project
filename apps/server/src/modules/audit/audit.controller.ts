import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { AuditService } from "./audit.service.js";

interface AuditQuery {
  page?: number;
  pageSize?: number;
  entityType?: string;
  actorId?: string;
}

export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as AuditQuery;
    const pagination = resolvePagination(query);
    const result = await this.auditService.list(pagination, {
      entityType: query.entityType,
      actorId: query.actorId,
    });
    sendSuccess(res, result, "Audit logs retrieved");
  });
}
