import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { ItemsController } from "./items.controller.js";
import {
  classifyBatchSchema,
  listItemsQuerySchema,
  renameItemSchema,
  updateItemCategorySchema,
} from "./items.validation.js";

/** Mounted at /items. Reuses rfq:read/rfq:update — items are the procurement price catalog. */
export function createItemsRouter(controller: ItemsController): Router {
  const router = Router();

  /**
   * @openapi
   * /items:
   *   get:
   *     tags: [Items]
   *     summary: List resolved items with price aggregates and classification (paginated, sortable)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated item catalog }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    validate(listItemsQuerySchema, "query"),
    controller.list,
  );

  /**
   * @openapi
   * /items/classify:
   *   post:
   *     tags: [Items]
   *     summary: AI-classify a batch of still-unclassified items into the taxonomy (needs Ollama)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Count classified / failed / remaining }
   */
  router.post(
    "/classify",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(classifyBatchSchema, "query"),
    controller.classifyBatch,
  );

  /**
   * @openapi
   * /items/{id}:
   *   get:
   *     tags: [Items]
   *     summary: Item detail — classification + every historical quote (tender, vendor, rate)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Item detail }
   *   patch:
   *     tags: [Items]
   *     summary: Confirm or override an item's category
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated item detail }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("rfq:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(updateItemCategorySchema),
    controller.setCategory,
  );

  /**
   * @openapi
   * /items/{id}/name:
   *   patch:
   *     tags: [Items]
   *     summary: Rename an item's canonical name (single source of truth for its refined/concise name)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated item detail }
   *       409: { description: Another item already has this name }
   */
  router.patch(
    "/:id/name",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(renameItemSchema),
    controller.rename,
  );

  /**
   * @openapi
   * /items/{id}/classify:
   *   post:
   *     tags: [Items]
   *     summary: AI-classify one item into the taxonomy, left unconfirmed for review (needs Ollama)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated item detail with the suggested category }
   */
  router.post(
    "/:id/classify",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    controller.classify,
  );

  return router;
}
