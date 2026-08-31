import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { ContactsController } from "./contacts.controller.js";
import { listLookupOptionsQuerySchema } from "./contacts.validation.js";

export function createContactsRouter(controller: ContactsController): Router {
  const router = Router();

  /**
   * @openapi
   * /contacts/lookup-options:
   *   get:
   *     tags: [Contacts]
   *     summary: List a business's saved department/designation values for autocomplete
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: kind
   *         required: true
   *         schema: { type: string, enum: [DEPARTMENT, DESIGNATION] }
   *     responses:
   *       200: { description: Lookup option values for the given kind }
   */
  router.get(
    "/lookup-options",
    authenticateMiddleware,
    validate(listLookupOptionsQuerySchema, "query"),
    controller.listLookupOptions,
  );

  return router;
}
