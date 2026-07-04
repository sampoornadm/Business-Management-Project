import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { RfqController } from "./rfq.controller.js";
import {
  addRfqVendorSchema,
  awardRfqSchema,
  createRfqSchema,
  listRfqsQuerySchema,
  updateRfqSchema,
  upsertRfqQuoteSchema,
} from "./rfq.validation.js";

/** Mounted at /rfqs */
export function createRfqRouter(controller: RfqController): Router {
  const router = Router();

  /**
   * @openapi
   * /rfqs:
   *   get:
   *     tags: [RFQ]
   *     summary: List RFQs (paginated, filterable by status/tender)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated RFQs }
   *   post:
   *     tags: [RFQ]
   *     summary: Create an RFQ (items from BOQ or manual, optionally invite vendors immediately)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: RFQ created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    validate(listRfqsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(createRfqSchema),
    controller.create,
  );

  /**
   * @openapi
   * /rfqs/{id}:
   *   get:
   *     tags: [RFQ]
   *     summary: Get an RFQ by id (items, quotes, invited vendors)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ }
   *   patch:
   *     tags: [RFQ]
   *     summary: Update an RFQ's title/due date
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ updated }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("rfq:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(updateRfqSchema),
    controller.update,
  );

  /**
   * @openapi
   * /rfqs/{id}/vendors:
   *   post:
   *     tags: [RFQ]
   *     summary: Invite a vendor to quote on this RFQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Vendor invited }
   */
  router.post(
    "/:id/vendors",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(addRfqVendorSchema),
    controller.addVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/vendors/{vendorId}:
   *   delete:
   *     tags: [RFQ]
   *     summary: Remove a vendor invite from this RFQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor invite removed }
   */
  router.delete(
    "/:id/vendors/:vendorId",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    controller.removeVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/comparison:
   *   get:
   *     tags: [RFQ]
   *     summary: Get the comparative statement (lowest rate per item, vendor totals)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Comparative statement }
   */
  router.get(
    "/:id/comparison",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.comparison,
  );

  /**
   * @openapi
   * /rfqs/{id}/award:
   *   post:
   *     tags: [RFQ]
   *     summary: Award the RFQ to an invited vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ awarded }
   */
  router.post(
    "/:id/award",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(awardRfqSchema),
    controller.award,
  );

  /**
   * @openapi
   * /rfqs/{id}/close:
   *   post:
   *     tags: [RFQ]
   *     summary: Close the RFQ (no more quotes accepted)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ closed }
   */
  router.post("/:id/close", authenticateMiddleware, requirePermission("rfq:update"), controller.close);

  return router;
}

/** Mounted at /rfq-items */
export function createRfqItemsRouter(controller: RfqController): Router {
  const router = Router();

  /**
   * @openapi
   * /rfq-items/{itemId}/quotes/{vendorId}:
   *   put:
   *     tags: [RFQ]
   *     summary: Record (upsert) a vendor's quoted rate for an RFQ item
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Quote recorded }
   */
  router.put(
    "/:itemId/quotes/:vendorId",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(upsertRfqQuoteSchema),
    controller.upsertQuote,
  );

  return router;
}
