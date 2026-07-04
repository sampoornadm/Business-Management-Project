import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { RolesController } from "./roles.controller.js";

export function createRolesRouter(controller: RolesController): Router {
  const router = Router();

  /**
   * @openapi
   * /roles:
   *   get:
   *     tags: [Roles]
   *     summary: List all roles with their permissions
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200:
   *         description: List of roles
   */
  router.get("/", authenticateMiddleware, requirePermission("roles:read"), controller.list);

  return router;
}
