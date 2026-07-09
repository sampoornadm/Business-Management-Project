import { Router } from "express";

import { VENDOR_ITEM_TAGS_IMPORT_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { VendorsController } from "./vendors.controller.js";
import {
  createContactSchema,
  createVendorItemTagSchema,
  createVendorSchema,
  listVendorsQuerySchema,
  updateContactSchema,
  updateVendorSchema,
} from "./vendors.validation.js";

export function createVendorsRouter(controller: VendorsController): Router {
  const router = Router();
  const uploadItemTagsFile = createUploadMiddleware(
    "file",
    VENDOR_ITEM_TAGS_IMPORT_LIMITS.MAX_SIZE_BYTES,
    VENDOR_ITEM_TAGS_IMPORT_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /vendors/item-tags/import:
   *   post:
   *     tags: [Vendors]
   *     summary: Bulk-import vendor item-type/make tags from an Excel file (columns Vendor Name, Item Type, Make)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Import result (imported count + skipped rows) }
   */
  router.post(
    "/item-tags/import",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    uploadItemTagsFile,
    controller.importItemTags,
  );

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

  /**
   * @openapi
   * /vendors/{id}/item-tags:
   *   post:
   *     tags: [Vendors]
   *     summary: Tag a vendor with an item type (and optional make) it supplies, for RFQ vendor suggestions
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Item tag added }
   */
  router.post(
    "/:id/item-tags",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    validate(createVendorItemTagSchema),
    controller.addItemTag,
  );

  /**
   * @openapi
   * /vendors/{id}/item-tags/{tagId}:
   *   delete:
   *     tags: [Vendors]
   *     summary: Remove an item tag from a vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: tagId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Item tag removed }
   */
  router.delete(
    "/:id/item-tags/:tagId",
    authenticateMiddleware,
    requirePermission("vendors:update"),
    controller.deleteItemTag,
  );

  return router;
}
