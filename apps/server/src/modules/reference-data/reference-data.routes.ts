import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { ReferenceDataController } from "./reference-data.controller.js";

export function createReferenceDataRouter(controller: ReferenceDataController): Router {
  const router = Router();
  const uploadHsnSacFile = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/status:
   *   get:
   *     tags: [ReferenceData]
   *     summary: Latest HSN/SAC reference data import status
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Latest import, or null if none has ever run }
   */
  router.get(
    "/hsn-sac/status",
    authenticateMiddleware,
    requirePermission("settings:read"),
    controller.status,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/refresh:
   *   post:
   *     tags: [ReferenceData]
   *     summary: Fetch the latest CBIC HSN/SAC master list now and re-import if it changed
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated (or unchanged) import status }
   */
  router.post(
    "/hsn-sac/refresh",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    controller.refresh,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/upload:
   *   post:
   *     tags: [ReferenceData]
   *     summary: Import a manually-provided HSN_SAC.xlsx file
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *     responses:
   *       201: { description: Import result }
   */
  router.post(
    "/hsn-sac/upload",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    uploadHsnSacFile,
    controller.upload,
  );

  return router;
}
