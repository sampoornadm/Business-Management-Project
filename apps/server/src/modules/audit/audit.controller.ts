import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { AUDIT_LOG_EXPORT_COLUMN_KEYS, buildAuditLogExportTable } from "./audit.mapper.js";
import type { AuditService } from "./audit.service.js";
import type { ExportAuditLogsQueryParsed, ListAuditLogsQueryParsed } from "./audit.validation.js";

export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListAuditLogsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.auditService.list(pagination, {
      entityType: query.entityType,
      actorId: query.actorId,
      filters: query.filters,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    sendSuccess(res, result, "Audit logs retrieved");
  });

  exportAuditLogs = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportAuditLogsQueryParsed;
    const pagination = resolvePagination(query);
    const items = await this.auditService.exportAuditLogs(
      {
        entityType: query.entityType,
        actorId: query.actorId,
        filters: query.filters,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? AUDIT_LOG_EXPORT_COLUMN_KEYS;
    const table = buildAuditLogExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="audit-log-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-export-${date}.csv"`);
    res.send(buffer);
  });
}
