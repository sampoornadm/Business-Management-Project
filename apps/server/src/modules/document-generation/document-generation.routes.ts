import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { DocumentGenerationController } from "./document-generation.controller.js";

export function createDocumentGenerationRouter(controller: DocumentGenerationController): Router {
  const router = Router();

  /**
   * @openapi
   * /tenders/{id}/documents/undertaking:
   *   post:
   *     tags: [Document Generation]
   *     summary: Generate a filled Undertaking .docx for a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Generated .docx file }
   *       404: { description: Tender not found, or the template file is missing }
   */
  router.post(
    "/:id/documents/undertaking",
    authenticateMiddleware,
    requirePermission("tenders:generate_document"),
    controller.generateUndertaking,
  );

  /**
   * @openapi
   * /tenders/{id}/documents/quotation:
   *   post:
   *     tags: [Document Generation]
   *     summary: Generate a Quotation (docx, csv, or pdf) from a tender's current BOQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: format
   *         schema: { type: string, enum: [docx, csv, pdf] }
   *     responses:
   *       200: { description: Generated document }
   *       404: { description: Tender not found, or it has no BOQ (or the docx template is missing) }
   */
  router.post(
    "/:id/documents/quotation",
    authenticateMiddleware,
    requirePermission("tenders:generate_document"),
    controller.generateQuotation,
  );

  return router;
}
