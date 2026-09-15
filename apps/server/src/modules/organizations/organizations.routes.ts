import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { OrganizationsController } from "./organizations.controller.js";
import {
  createContactSchema,
  createOrganizationSchema,
  exportOrganizationsQuerySchema,
  listOrganizationsQuerySchema,
  updateContactSchema,
  updateOrganizationSchema,
} from "./organizations.validation.js";

export function createOrganizationsRouter(controller: OrganizationsController): Router {
  const router = Router();

  /**
   * @openapi
   * /organizations:
   *   get:
   *     tags: [Organizations]
   *     summary: List client organizations (searchable, paginated)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated organizations }
   *   post:
   *     tags: [Organizations]
   *     summary: Create a client organization
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Organization created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("organizations:read"),
    validate(listOrganizationsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("organizations:create"),
    validate(createOrganizationSchema),
    controller.create,
  );

  /**
   * @openapi
   * /organizations/export:
   *   get:
   *     tags: [Organizations]
   *     summary: Export organizations matching the current filters as CSV or XLSX
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: format
   *         required: true
   *         schema: { type: string, enum: [csv, xlsx] }
   *       - in: query
   *         name: scope
   *         required: true
   *         schema: { type: string, enum: [view, all] }
   *     responses:
   *       200: { description: File download }
   */
  router.get(
    "/export",
    authenticateMiddleware,
    requirePermission("organizations:read"),
    validate(exportOrganizationsQuerySchema, "query"),
    controller.exportOrganizations,
  );

  /**
   * @openapi
   * /organizations/{id}:
   *   get:
   *     tags: [Organizations]
   *     summary: Get an organization by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Organization }
   *   patch:
   *     tags: [Organizations]
   *     summary: Update an organization
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Organization updated }
   *   delete:
   *     tags: [Organizations]
   *     summary: Delete an organization (blocked if referenced by any tender)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Organization deleted }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("organizations:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("organizations:update"),
    validate(updateOrganizationSchema),
    controller.update,
  );
  router.delete(
    "/:id",
    authenticateMiddleware,
    requirePermission("organizations:delete"),
    controller.deleteById,
  );

  /**
   * @openapi
   * /organizations/{id}/contacts:
   *   post:
   *     tags: [Organizations]
   *     summary: Add a contact to an organization
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
    requirePermission("organizations:update"),
    validate(createContactSchema),
    controller.addContact,
  );

  /**
   * @openapi
   * /organizations/{id}/contacts/{contactId}:
   *   patch:
   *     tags: [Organizations]
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
   *     tags: [Organizations]
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
    requirePermission("organizations:update"),
    validate(updateContactSchema),
    controller.updateContact,
  );
  router.delete(
    "/:id/contacts/:contactId",
    authenticateMiddleware,
    requirePermission("organizations:update"),
    controller.deleteContact,
  );

  return router;
}
