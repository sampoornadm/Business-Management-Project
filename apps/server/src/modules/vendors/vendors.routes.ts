import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { VendorsController } from "./vendors.controller.js";
import {
  createContactSchema,
  createVendorSchema,
  listVendorsQuerySchema,
  updateContactSchema,
  updateVendorSchema,
} from "./vendors.validation.js";

export function createVendorsRouter(controller: VendorsController): Router {
  const router = Router();

  /**
   * @openapi
   * /vendors:
   *   get:
   *     tags: [Vendors]
   *     summary: List vendors (searchable, paginated)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated vendors }
   *   post:
   *     tags: [Vendors]
   *     summary: Create a vendor
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Vendor created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("vendors:read"),
    validate(listVendorsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("vendors:create"),
    validate(createVendorSchema),
    controller.create,
  );

  /**
   * @openapi
   * /vendors/{id}:
   *   get:
   *     tags: [Vendors]
   *     summary: Get a vendor by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor }
   *   patch:
   *     tags: [Vendors]
   *     summary: Update a vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor updated }
   *   delete:
   *     tags: [Vendors]
   *     summary: Delete a vendor (blocked if referenced by any purchase order)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor deleted }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("vendors:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    validate(updateVendorSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("vendors:delete"), controller.deleteById);

  /**
   * @openapi
   * /vendors/{id}/performance:
   *   get:
   *     tags: [Vendors]
   *     summary: Get a vendor's rating history and average rating
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor performance }
   */
  router.get(
    "/:id/performance",
    authenticateMiddleware,
    requirePermission("vendors:read"),
    controller.getPerformance,
  );

  /**
   * @openapi
   * /vendors/{id}/contacts:
   *   post:
   *     tags: [Vendors]
   *     summary: Add a contact to a vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Contact added }
   */
  router.post(
    "/:id/contacts",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    validate(createContactSchema),
    controller.addContact,
  );

  /**
   * @openapi
   * /vendors/{id}/contacts/{contactId}:
   *   patch:
   *     tags: [Vendors]
   *     summary: Update a contact
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: contactId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Contact updated }
   *   delete:
   *     tags: [Vendors]
   *     summary: Delete a contact
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: contactId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Contact deleted }
   */
  router.patch(
    "/:id/contacts/:contactId",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    validate(updateContactSchema),
    controller.updateContact,
  );
  router.delete(
    "/:id/contacts/:contactId",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    controller.deleteContact,
  );

  return router;
}
