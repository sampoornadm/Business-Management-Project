import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { TagsController } from "./tags.controller.js";
import { createTagSchema, updateTagSchema } from "./tags.validation.js";

export function createTagsRouter(controller: TagsController): Router {
  const router = Router();

  /**
   * @openapi
   * /tags:
   *   get:
   *     tags: [Tags]
   *     summary: List all tags
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: List of tags }
   *   post:
   *     tags: [Tags]
   *     summary: Create a tag
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Tag created }
   */
  router.get("/", authenticateMiddleware, requirePermission("tags:read"), controller.list);
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("tags:create"),
    validate(createTagSchema),
    controller.create,
  );

  /**
   * @openapi
   * /tags/{id}:
   *   patch:
   *     tags: [Tags]
   *     summary: Update a tag
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tag updated }
   *   delete:
   *     tags: [Tags]
   *     summary: Delete a tag
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tag deleted }
   */
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("tags:update"),
    validate(updateTagSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("tags:delete"), controller.deleteById);

  return router;
}
