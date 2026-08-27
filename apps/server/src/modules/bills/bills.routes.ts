import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { BillsController } from "./bills.controller.js";
import { createBillSchema, listBillsQuerySchema } from "./bills.validation.js";

/** Mounted at /bills */
export function createBillsRouter(controller: BillsController): Router {
  const router = Router();

  /**
   * @openapi
   * /bills:
   *   get:
   *     tags: [Bills]
   *     summary: List bills (paginated), across every tender for the business
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated bills }
   *   post:
   *     tags: [Bills]
   *     summary: Create a bill against a WON tender
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Bill created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("bills:read"),
    validate(listBillsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("bills:create"),
    validate(createBillSchema),
    controller.create,
  );

  /**
   * @openapi
   * /bills/{id}:
   *   get:
   *     tags: [Bills]
   *     summary: Get a bill by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Bill }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("bills:read"), controller.getById);

  return router;
}
