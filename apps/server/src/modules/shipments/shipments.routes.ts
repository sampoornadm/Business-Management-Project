import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS, TENDER_EXTRACTION_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { ShipmentsController } from "./shipments.controller.js";
import {
  createShipmentSchema,
  dispatchShipmentSchema,
  recordShipmentGrnSchema,
  recordShipmentPaymentSchema,
  updateShipmentSchema,
  uploadShipmentDocumentSchema,
} from "./shipments.validation.js";

/** Mounted under /projects. */
export function createProjectSupplyRouter(controller: ShipmentsController): Router {
  const router = Router();

  /**
   * @openapi
   * /projects/{projectId}/supply:
   *   get:
   *     tags: [Shipments]
   *     summary: Each ordered item's progress (ordered, bought, received, dispatched, accepted) and the project's shipments
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Supply progress }
   */
  router.get("/:projectId/supply", authenticateMiddleware, requirePermission("shipments:read"), controller.getSupply);

  /**
   * @openapi
   * /projects/{projectId}/shipments:
   *   post:
   *     tags: [Shipments]
   *     summary: Start a shipment against one client PO
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Shipment created }
   */
  router.post(
    "/:projectId/shipments",
    authenticateMiddleware,
    requirePermission("shipments:create"),
    validate(createShipmentSchema),
    controller.create,
  );

  /**
   * @openapi
   * /projects/{projectId}/documents/read:
   *   post:
   *     tags: [Shipments]
   *     summary: Read an e-way bill, GRN or vendor invoice (PDF/DOCX/XLSX) and find the shipment or vendor PO it belongs to; nothing is saved
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Fields read and the matching shipments / vendor PO }
   */
  router.post(
    "/:projectId/documents/read",
    authenticateMiddleware,
    requirePermission("shipments:read"),
    createUploadMiddleware(
      "file",
      TENDER_EXTRACTION_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      TENDER_EXTRACTION_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
    ),
    controller.readDocument,
  );
  return router;
}

/** Mounted at /shipments. Each POST action moves the shipment one stage on. */
export function createShipmentsRouter(controller: ShipmentsController): Router {
  const router = Router();
  const uploadDocument = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /shipments/{id}:
   *   get:
   *     tags: [Shipments]
   *     summary: One shipment
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Shipment }
   *   patch:
   *     tags: [Shipments]
   *     summary: Edit notes/transport details; items only while preparing
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Shipment updated }
   *   delete:
   *     tags: [Shipments]
   *     summary: Delete a shipment that has no GRN or bill yet
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Shipment deleted }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("shipments:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    validate(updateShipmentSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("shipments:delete"), controller.delete);

  /**
   * @openapi
   * /shipments/{id}/dispatch:
   *   post:
   *     tags: [Shipments]
   *     summary: Mark sent, with its e-way bill
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Dispatched }
   * /shipments/{id}/grn:
   *   post:
   *     tags: [Shipments]
   *     summary: Record the client's GRN
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: GRN recorded }
   * /shipments/{id}/bill:
   *   post:
   *     tags: [Shipments]
   *     summary: Raise the bill for the shipment at the client PO rates
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Bill raised }
   * /shipments/{id}/payments:
   *   post:
   *     tags: [Shipments]
   *     summary: Record the client's payment for the shipment's bill; settled closes it
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Payment recorded }
   * /shipments/{id}/undo:
   *   post:
   *     tags: [Shipments]
   *     summary: Step back one stage (not past a raised bill)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Stepped back }
   * /shipments/{id}/documents:
   *   post:
   *     tags: [Shipments]
   *     summary: Attach an e-way bill, technical document, GRN or other file
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Attached }
   */
  router.post(
    "/:id/dispatch",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    validate(dispatchShipmentSchema),
    controller.dispatch,
  );
  router.post(
    "/:id/grn",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    validate(recordShipmentGrnSchema),
    controller.recordGrn,
  );
  router.post(
    "/:id/bill",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    requirePermission("bills:create"),
    controller.createBill,
  );
  router.post(
    "/:id/payments",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    requirePermission("finance:create"),
    validate(recordShipmentPaymentSchema),
    controller.recordPayment,
  );
  router.post("/:id/undo", authenticateMiddleware, requirePermission("shipments:update"), controller.undo);
  router.post(
    "/:id/documents",
    authenticateMiddleware,
    requirePermission("shipments:update"),
    uploadDocument,
    validate(uploadShipmentDocumentSchema),
    controller.uploadDocument,
  );
  return router;
}
