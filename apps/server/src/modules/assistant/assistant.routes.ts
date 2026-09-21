import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AssistantController } from "./assistant.controller.js";
import { assistantQuerySchema } from "./assistant.validation.js";

/** Mounted at /assistant */
export function createAssistantRouter(controller: AssistantController): Router {
  const router = Router();

  /**
   * @openapi
   * /assistant/query:
   *   post:
   *     tags: [Assistant]
   *     summary: Natural-language search over tenders, RFQs, POs and bills (item/status/date filters, follow-ups via echoed state)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Reply, result links, filter chips, and the query state to send back with the next message }
   */
  router.post(
    "/query",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(assistantQuerySchema),
    controller.query,
  );

  return router;
}
