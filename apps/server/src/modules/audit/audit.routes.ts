import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AuditController } from "./audit.controller.js";
import { listAuditLogsQuerySchema } from "./audit.validation.js";

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

  return router;
}
