import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { PortalBidController } from "./portal-bid.controller.js";

export function createPortalBidRouter(controller: PortalBidController): Router {
  const router = Router();

  /**
   * @openapi
   * /portal-bids/by-response/{responseNumber}:
   *   get:
   *     tags: [Portal bids]
   *     summary: Find the tender a portal response number was filed for
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: responseNumber, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: The tender id, number and bid status }
   *       404: { description: No bid under that response number }
   */
  router.get(
    "/by-response/:responseNumber",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.getByResponseNumber,
  );

  return router;
}
