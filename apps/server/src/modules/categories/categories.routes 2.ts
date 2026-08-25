import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { CategoriesController } from "./categories.controller.js";
import { createCategorySchema, updateCategorySchema } from "./categories.validation.js";

/** Mounted at /categories. Reuses rfq:read/rfq:update — the taxonomy is procurement master data. */
export function createCategoriesRouter(controller: CategoriesController): Router {
  const router = Router();

  /**
   * @openapi
   * /categories:
   *   get:
   *     tags: [Categories]
   *     summary: Get the classification taxonomy as a tree
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Category tree }
   *   post:
   *     tags: [Categories]
   *     summary: Add a category node (top-level if parentId omitted)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Updated tree }
   */
  router.get("/", authenticateMiddleware, requirePermission("rfq:read"), controller.tree);
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(createCategorySchema),
    controller.create,
  );

  /**
   * @openapi
   * /categories/leaves:
   *   get:
   *     tags: [Categories]
   *     summary: Flat list of leaf categories with their full path, for pickers
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Category leaves }
   */
  router.get("/leaves", authenticateMiddleware, requirePermission("rfq:read"), controller.leaves);

  /**
   * @openapi
   * /categories/{id}:
   *   patch:
   *     tags: [Categories]
   *     summary: Rename or reorder a category node
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated tree }
   *   delete:
   *     tags: [Categories]
   *     summary: Delete a category node (children cascade, items are unclassified)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated tree }
   */
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(updateCategorySchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("rfq:update"), controller.remove);

  return router;
}
