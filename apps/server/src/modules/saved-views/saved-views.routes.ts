import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { SavedViewsController } from "./saved-views.controller.js";
import {
  createSavedViewSchema,
  listSavedViewsQuerySchema,
  updateSavedViewSchema,
} from "./saved-views.validation.js";

export function createSavedViewsRouter(controller: SavedViewsController): Router {
  const router = Router();

  /**
   * @openapi
   * /saved-views:
   *   get:
   *     tags: [SavedViews]
   *     summary: List the current user's saved views for one page
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: pageKey
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved views }
   *   post:
   *     tags: [SavedViews]
   *     summary: Save the current filters, columns, and sort as a new named view
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Saved view created }
   */
  router.get("/", authenticateMiddleware, validate(listSavedViewsQuerySchema, "query"), controller.list);
  router.post("/", authenticateMiddleware, validate(createSavedViewSchema), controller.create);

  /**
   * @openapi
   * /saved-views/{id}:
   *   patch:
   *     tags: [SavedViews]
   *     summary: Rename or update a saved view's contents (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved view updated }
   *   delete:
   *     tags: [SavedViews]
   *     summary: Delete a saved view (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Saved view deleted }
   */
  router.patch("/:id", authenticateMiddleware, validate(updateSavedViewSchema), controller.update);
  router.delete("/:id", authenticateMiddleware, controller.remove);

  return router;
}
