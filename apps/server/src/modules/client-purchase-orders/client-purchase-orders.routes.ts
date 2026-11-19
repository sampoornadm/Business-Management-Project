import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS, TENDER_EXTRACTION_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { ClientPurchaseOrdersController } from "./client-purchase-orders.controller.js";
import {
  createClientPurchaseOrderSchema,
  updateClientPurchaseOrderSchema,
} from "./client-purchase-orders.validation.js";

/** Mounted under /projects: the project's client POs. */
export function createProjectClientPurchaseOrdersRouter(controller: ClientPurchaseOrdersController): Router {
  const router = Router({ mergeParams: true });
  const uploadForExtraction = createUploadMiddleware(
    "file",
    TENDER_EXTRACTION_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    TENDER_EXTRACTION_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /projects/{projectId}/client-purchase-orders:
   *   get:
   *     tags: [Client purchase orders]
   *     summary: The project's client POs, each line checked against our current BOQ, plus BOQ lines not ordered yet
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Client POs }
   *   post:
   *     tags: [Client purchase orders]
   *     summary: Record a client PO on the project
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Client PO recorded }
   */
  router.get(
    "/:projectId/client-purchase-orders",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:read"),
    controller.listForProject,
  );
  router.post(
    "/:projectId/client-purchase-orders",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:create"),
    validate(createClientPurchaseOrderSchema),
    controller.create,
  );

  /**
   * @openapi
   * /projects/{projectId}/client-purchase-orders/extract:
   *   post:
   *     tags: [Client purchase orders]
   *     summary: Read a client PO document (PDF/DOCX/XLSX) into a draft, linked to our BOQ; nothing is saved
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Draft fields }
   */
  router.post(
    "/:projectId/client-purchase-orders/extract",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:create"),
    uploadForExtraction,
    controller.extract,
  );
  return router;
}

/** Mounted at /client-purchase-orders: one client PO. */
export function createClientPurchaseOrdersRouter(controller: ClientPurchaseOrdersController): Router {
  const router = Router();
  const uploadDocument = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /client-purchase-orders/{id}:
   *   get:
   *     tags: [Client purchase orders]
   *     summary: One client PO
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Client PO }
   *   patch:
   *     tags: [Client purchase orders]
   *     summary: Update a client PO; items, when sent, replace every line
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Client PO updated }
   *   delete:
   *     tags: [Client purchase orders]
   *     summary: Delete a client PO and its documents
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Client PO deleted }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("client_purchase_orders:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:update"),
    validate(updateClientPurchaseOrderSchema),
    controller.update,
  );
  router.delete(
    "/:id",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:delete"),
    controller.delete,
  );

  /**
   * @openapi
   * /client-purchase-orders/{id}/document:
   *   post:
   *     tags: [Client purchase orders]
   *     summary: Attach the client's PO document (PDF, scan, Word, Excel)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Document attached }
   */
  router.post(
    "/:id/document",
    authenticateMiddleware,
    requirePermission("client_purchase_orders:update"),
    uploadDocument,
    controller.uploadDocument,
  );
  return router;
}
