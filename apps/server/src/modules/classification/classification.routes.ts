import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { ClassificationController } from "./classification.controller.js";

export function createClassificationRouter(controller: ClassificationController): Router {
  const router = Router();

  /**
   * @openapi
   * /classification/status:
   *   get:
   *     tags: [Classification]
   *     summary: Whether a model is installed, and how the last rebuild went
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Model availability and the latest run, or null if none has run }
   */
  router.get("/status", authenticateMiddleware, requirePermission("settings:read"), controller.status);

  /**
   * @openapi
   * /classification/rebuild:
   *   post:
   *     tags: [Classification]
   *     summary: Rebuild the taxonomy, datasets and classifier from the lookup sheet
   *     description: >
   *       Reads ml/data/hsn-gst-lookup.xlsx from disk and queues the rebuild. Returns immediately;
   *       poll /classification/status for progress. Refuses while a rebuild is already running.
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       202: { description: Rebuild queued }
   *       409: { description: A rebuild is already running }
   */
  router.post(
    "/rebuild",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    controller.rebuild,
  );

  /**
   * @openapi
   * /classification/rebuild/cancel:
   *   post:
   *     tags: [Classification]
   *     summary: Stop a rebuild that is in flight
   *     description: >
   *       Kills the trainer, drains the queue so a restarted worker does not resume it, and marks
   *       the run cancelled. Nothing is deployed, so the model already in use is unchanged.
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Cancelled }
   *       404: { description: No rebuild is running }
   */
  router.post(
    "/rebuild/cancel",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    controller.cancel,
  );

  return router;
}
