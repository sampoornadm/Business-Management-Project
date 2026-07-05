import { Router } from "express";

import { BOQ_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { BoqController } from "./boq.controller.js";
import {
  bulkUpdateBoqItemsSchema,
  commitBoqSchema,
  compareBoqQuerySchema,
  createBoqItemSchema,
  updateBoqItemSchema,
  upsertRateAnalysisSchema,
} from "./boq.validation.js";

/** Mounted at /tenders — nests BOQ endpoints under a specific tender, same convention as documents/assignees. */
export function createBoqRouter(controller: BoqController): Router {
  const router = Router();
  const uploadBoqFile = createUploadMiddleware(
    "file",
    BOQ_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    BOQ_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /tenders/{id}/boq/parse:
   *   post:
   *     tags: [BOQ]
   *     summary: Upload and parse a BOQ file into a column-mapping preview (no BOQ rows written yet)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *     responses:
   *       200: { description: Parsed preview rows and suggested column mapping }
   */
  router.post(
    "/:id/boq/parse",
    authenticateMiddleware,
    requirePermission("boq:create"),
    uploadBoqFile,
    controller.parse,
  );

  /**
   * @openapi
   * /tenders/{id}/boq:
   *   get:
   *     tags: [BOQ]
   *     summary: Get the current BOQ (nested item tree) for a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Current BOQ }
   *   post:
   *     tags: [BOQ]
   *     summary: Commit mapped rows as a new BOQ version
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: BOQ committed }
   */
  router.get("/:id/boq", authenticateMiddleware, requirePermission("boq:read"), controller.getCurrent);
  router.post(
    "/:id/boq",
    authenticateMiddleware,
    requirePermission("boq:create"),
    validate(commitBoqSchema),
    controller.commit,
  );

  /**
   * @openapi
   * /tenders/{id}/boq/items:
   *   post:
   *     tags: [BOQ]
   *     summary: Add a single item to the tender's current BOQ (creates an empty version 1 first if none exists yet)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Item added }
   */
  router.post(
    "/:id/boq/items",
    authenticateMiddleware,
    requirePermission("boq:create"),
    validate(createBoqItemSchema),
    controller.addItem,
  );

  /**
   * @openapi
   * /tenders/{id}/boq/versions:
   *   get:
   *     tags: [BOQ]
   *     summary: List all versions of a tender's BOQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: List of BOQ versions }
   */
  router.get(
    "/:id/boq/versions",
    authenticateMiddleware,
    requirePermission("boq:read"),
    controller.listVersions,
  );

  /**
   * @openapi
   * /tenders/{id}/boq/finalize:
   *   patch:
   *     tags: [BOQ]
   *     summary: Mark the current BOQ version as finalized
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: BOQ finalized }
   */
  router.patch(
    "/:id/boq/finalize",
    authenticateMiddleware,
    requirePermission("boq:update"),
    controller.finalize,
  );

  /**
   * @openapi
   * /tenders/{id}/boq/compare:
   *   get:
   *     tags: [BOQ]
   *     summary: Compare this tender's current BOQ against another tender's current BOQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: withTenderId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Line-by-line comparison }
   */
  router.get(
    "/:id/boq/compare",
    authenticateMiddleware,
    requirePermission("boq:read"),
    validate(compareBoqQuerySchema, "query"),
    controller.compare,
  );

  return router;
}

/** Mounted at /boq-items — item-level mutations aren't naturally nested under a single tender path. */
export function createBoqItemsRouter(controller: BoqController): Router {
  const router = Router();

  /**
   * @openapi
   * /boq-items/bulk-update:
   *   post:
   *     tags: [BOQ]
   *     summary: Apply a percentage rate adjustment to a set of BOQ items in one transaction
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated BOQ }
   */
  router.post(
    "/bulk-update",
    authenticateMiddleware,
    requirePermission("boq:update"),
    validate(bulkUpdateBoqItemsSchema),
    controller.bulkUpdate,
  );

  /**
   * @openapi
   * /boq-items/{itemId}:
   *   patch:
   *     tags: [BOQ]
   *     summary: Update a single BOQ item's fields
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated BOQ }
   */
  router.patch(
    "/:itemId",
    authenticateMiddleware,
    requirePermission("boq:update"),
    validate(updateBoqItemSchema),
    controller.updateItem,
  );

  /**
   * @openapi
   * /boq-items/{itemId}:
   *   delete:
   *     tags: [BOQ]
   *     summary: Delete a single BOQ item
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated BOQ }
   */
  router.delete(
    "/:itemId",
    authenticateMiddleware,
    requirePermission("boq:update"),
    controller.deleteItem,
  );

  /**
   * @openapi
   * /boq-items/{itemId}/rate-analysis:
   *   put:
   *     tags: [BOQ]
   *     summary: Upsert a BOQ item's cost breakdown and recompute its rate
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated BOQ }
   */
  router.put(
    "/:itemId/rate-analysis",
    authenticateMiddleware,
    requirePermission("boq:update"),
    validate(upsertRateAnalysisSchema),
    controller.upsertRateAnalysis,
  );

  return router;
}
