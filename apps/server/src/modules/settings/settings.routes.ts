import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { SettingsController } from "./settings.controller.js";
import { settingKeyParamSchema, updateSettingBodySchema } from "./settings.validation.js";

export function createSettingsRouter(controller: SettingsController): Router {
  const router = Router();

  /**
   * @openapi
   * /settings:
   *   get:
   *     tags: [Settings]
   *     summary: List all system settings with their current effective value
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: All settings, grouped }
   */
  router.get("/", authenticateMiddleware, requirePermission("settings:read"), controller.list);

  /**
   * @openapi
   * /settings/{key}:
   *   patch:
   *     tags: [Settings]
   *     summary: Update one system setting
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated setting }
   */
  router.patch(
    "/:key",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    validate(settingKeyParamSchema, "params"),
    validate(updateSettingBodySchema),
    controller.update,
  );

  return router;
}
