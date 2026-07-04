import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { PermissionsController } from "./permissions.controller.js";

export function createPermissionsRouter(controller: PermissionsController): Router {
  const router = Router();

  /**
   * @openapi
   * /permissions:
   *   get:
   *     tags: [Permissions]
   *     summary: List all available permissions
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200:
   *         description: List of permissions
   */
  router.get("/", authenticateMiddleware, requirePermission("permissions:read"), controller.list);

  return router;
}
