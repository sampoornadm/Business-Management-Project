import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AuditController } from "./audit.controller.js";
import { exportAuditLogsQuerySchema, listAuditLogsQuerySchema } from "./audit.validation.js";

export function createAuditRouter(controller: AuditController): Router {
  const router = Router();

  /**
   * @openapi
   * /audit-logs:
   *   get:
   *     tags: [Audit]
   *     summary: List audit log entries (admin only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated audit log entries }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("audit:read"),
    validate(listAuditLogsQuerySchema, "query"),
    controller.list,
  );

  /**
   * @openapi
   * /audit-logs/export:
   *   get:
   *     tags: [Audit]
   *     summary: Export audit log entries matching the current filters as CSV or XLSX
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [csv, xlsx] }
   *       - in: query
   *         name: scope
   *         required: true
   *         schema: { type: string, enum: [view, all] }
   *     responses:
   *       200: { description: File download }
   */
  // This module has no "/:id" route, so (unlike tenders/businesses) there's no Express
  // param-shadowing ordering concern here — kept after the list route for readability only.
  router.get(
    "/export",
    authenticateMiddleware,
    requirePermission("audit:read"),
    validate(exportAuditLogsQuerySchema, "query"),
    controller.exportAuditLogs,
  );

  return router;
}
