import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { RatesController } from "./rates.controller.js";
import {
  createHistoricalRateSchema,
  listHistoricalRatesQuerySchema,
  suggestHistoricalRatesQuerySchema,
} from "./rates.validation.js";

export function createRatesRouter(controller: RatesController): Router {
  const router = Router();

  /**
   * @openapi
   * /rates:
   *   get:
   *     tags: [Rates]
   *     summary: List historical rates, optionally filtered by category/itemName
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: List of historical rates }
   *   post:
   *     tags: [Rates]
   *     summary: Record a historical rate
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Historical rate recorded }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("rates:read"),
    validate(listHistoricalRatesQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("rates:create"),
    validate(createHistoricalRateSchema),
    controller.create,
  );

  /**
   * @openapi
   * /rates/suggest:
   *   get:
   *     tags: [Rates]
   *     summary: Suggest historical rates for an item name/category, for rate-analysis prefill
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Suggested rates, most recent first }
   */
  router.get(
    "/suggest",
    authenticateMiddleware,
    requirePermission("rates:read"),
    validate(suggestHistoricalRatesQuerySchema, "query"),
    controller.suggest,
  );

  return router;
}
