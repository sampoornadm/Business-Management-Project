import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AttachmentsController } from "./attachments.controller.js";
import { listAttachmentsQuerySchema, uploadAttachmentBodySchema } from "./attachments.validation.js";
import { createUploadMiddleware } from "./upload.middleware.js";

export function createAttachmentsRouter(controller: AttachmentsController): Router {
  const router = Router();
  const uploadFile = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /attachments:
   *   get:
   *     tags: [Attachments]
   *     summary: List attachments for an entity
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: entityType
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: entityId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: List of attachments
   *   post:
   *     tags: [Attachments]
   *     summary: Upload a generic attachment for an entity
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *               entityType: { type: string }
   *               entityId: { type: string }
   *     responses:
   *       201:
   *         description: File uploaded
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("attachments:read"),
    validate(listAttachmentsQuerySchema, "query"),
    controller.list,
  );

  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("attachments:create"),
    uploadFile,
    validate(uploadAttachmentBodySchema),
    controller.upload,
  );

  /**
   * @openapi
   * /attachments/{id}:
   *   get:
   *     tags: [Attachments]
   *     summary: Get attachment metadata and a presigned URL
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Attachment metadata
   *   delete:
   *     tags: [Attachments]
   *     summary: Delete an attachment and its variants
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Attachment deleted
   */
  router.get("/:id", authenticateMiddleware, requirePermission("attachments:read"), controller.getById);
  router.delete(
    "/:id",
    authenticateMiddleware,
    requirePermission("attachments:delete"),
    controller.deleteById,
  );

  return router;
}
