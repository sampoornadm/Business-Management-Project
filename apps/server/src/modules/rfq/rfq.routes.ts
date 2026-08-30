import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { RfqController } from "./rfq.controller.js";
import {
  addRfqVendorSchema,
  createRfqSchema,
  importQuotesSchema,
  inviteVendorPreviewSchema,
  inviteVendorSchema,
  listItemPricesQuerySchema,
  listRfqsQuerySchema,
  selectQuoteSchema,
  suggestVendorsSchema,
  updateRfqSchema,
  upsertRfqQuoteSchema,
} from "./rfq.validation.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Mounted at /rfqs */
export function createRfqRouter(controller: RfqController): Router {
  const router = Router();
  const uploadQuoteSheet = createUploadMiddleware("file", 5 * 1024 * 1024, [XLSX_MIME]);

  /**
   * @openapi
   * /rfqs:
   *   get:
   *     tags: [RFQ]
   *     summary: List RFQs (paginated, filterable by status/tender)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated RFQs }
   *   post:
   *     tags: [RFQ]
   *     summary: Create an RFQ (items from BOQ or manual, optionally invite vendors immediately)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: RFQ created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    validate(listRfqsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(createRfqSchema),
    controller.create,
  );

  /**
   * @openapi
   * /rfqs/suggest-vendors:
   *   post:
   *     tags: [RFQ]
   *     summary: Suggest vendors for a set of BOQ items, based on vendor item-type/make tags
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Per-item and overall recommended vendor suggestions }
   */
  router.post(
    "/suggest-vendors",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    validate(suggestVendorsSchema),
    controller.suggestVendors,
  );

  /**
   * @openapi
   * /rfqs/item-prices:
   *   get:
   *     tags: [RFQ]
   *     summary: Historical vendor prices per item across all RFQs (paginated, search + vendor filter)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated item price history }
   */
  router.get(
    "/item-prices",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    validate(listItemPricesQuerySchema, "query"),
    controller.itemPrices,
  );

  /**
   * @openapi
   * /rfqs/{id}:
   *   get:
   *     tags: [RFQ]
   *     summary: Get an RFQ by id (items, quotes, invited vendors)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ }
   *   patch:
   *     tags: [RFQ]
   *     summary: Update an RFQ's title/due date
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ updated }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("rfq:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(updateRfqSchema),
    controller.update,
  );

  /**
   * @openapi
   * /rfqs/{id}/vendors:
   *   post:
   *     tags: [RFQ]
   *     summary: Invite a vendor to quote on this RFQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Vendor invited }
   */
  router.post(
    "/:id/vendors",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(addRfqVendorSchema),
    controller.addVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/vendors/{vendorId}:
   *   delete:
   *     tags: [RFQ]
   *     summary: Remove a vendor invite from this RFQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor invite removed }
   */
  router.delete(
    "/:id/vendors/:vendorId",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    controller.removeVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/comparison:
   *   get:
   *     tags: [RFQ]
   *     summary: Get the comparative statement (lowest rate per item, vendor totals)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Comparative statement }
   */
  router.get(
    "/:id/comparison",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.comparison,
  );

  /**
   * @openapi
   * /rfqs/{id}/quote-sheet:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a pre-filled quote sheet for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: xlsx file }
   */
  router.get(
    "/:id/quote-sheet",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadQuoteSheet,
  );

  /**
   * @openapi
   * /rfqs/{id}/documents/pdf:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a Request-for-Rates PDF for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: pdf file }
   */
  router.get(
    "/:id/documents/pdf",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadRfrPdf,
  );

  /**
   * @openapi
   * /rfqs/{id}/documents/word:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a Request-for-Rates Word document for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: docx file }
   */
  router.get(
    "/:id/documents/word",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadRfrWord,
  );

  /**
   * @openapi
   * /rfqs/{id}/quotes/import:
   *   post:
   *     tags: [RFQ]
   *     summary: Import a filled quote sheet for one vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Import summary with per-row errors }
   */
  router.post(
    "/:id/quotes/import",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    uploadQuoteSheet,
    validate(importQuotesSchema),
    controller.importQuotes,
  );

  /**
   * @openapi
   * /rfqs/{id}/items/{itemId}/select-quote:
   *   post:
   *     tags: [RFQ]
   *     summary: Select a vendor's quote as the awarded quote for one RFQ item
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Quote selected }
   */
  router.post(
    "/:id/items/:itemId/select-quote",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(selectQuoteSchema),
    controller.selectQuote,
  );

  /**
   * @openapi
   * /rfqs/{id}/invite-vendor/preview:
   *   post:
   *     tags: [RFQ]
   *     summary: Generate (without sending) the plain-text invite body for a vendor on this RFQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Generated text + the vendor contact email it would be sent to }
   */
  router.post(
    "/:id/invite-vendor/preview",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(inviteVendorPreviewSchema),
    controller.previewInviteVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/invite-vendor:
   *   post:
   *     tags: [RFQ]
   *     summary: Invite a vendor to this RFQ and immediately email the given text to them
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Vendor invited and email queued }
   */
  router.post(
    "/:id/invite-vendor",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(inviteVendorSchema),
    controller.inviteVendor,
  );

  /**
   * @openapi
   * /rfqs/{id}/close:
   *   post:
   *     tags: [RFQ]
   *     summary: Close the RFQ (no more quotes accepted)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ closed }
   */
  router.post("/:id/close", authenticateMiddleware, requirePermission("rfq:update"), controller.close);

  /**
   * @openapi
   * /rfqs/{id}/reopen:
   *   post:
   *     tags: [RFQ]
   *     summary: Reopen a finalized RFQ (CLOSED/CANCELLED) back to SENT/DRAFT for further quotes
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: RFQ reopened }
   */
  router.post("/:id/reopen", authenticateMiddleware, requirePermission("rfq:update"), controller.reopen);

  /**
   * @openapi
   * /rfqs/{id}/push-rates-to-tender:
   *   post:
   *     tags: [RFQ]
   *     summary: Push each RFQ item's selected vendor quote onto its linked tender BOQ item's rate
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Rates pushed to tender }
   */
  router.post("/:id/push-rates-to-tender", authenticateMiddleware, requirePermission("rfq:update"), controller.pushRatesToTender);

  return router;
}

/** Mounted at /rfq-items */
export function createRfqItemsRouter(controller: RfqController): Router {
  const router = Router();

  /**
   * @openapi
   * /rfq-items/{itemId}/quotes/{vendorId}:
   *   put:
   *     tags: [RFQ]
   *     summary: Record (upsert) a vendor's quoted rate for an RFQ item
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: itemId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Quote recorded }
   */
  router.put(
    "/:itemId/quotes/:vendorId",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(upsertRfqQuoteSchema),
    controller.upsertQuote,
  );

  return router;
}
