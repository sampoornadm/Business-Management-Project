import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { BusinessesController } from "./businesses.controller.js";
import {
  addMemberSchema,
  createBusinessSchema,
  createContactSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
  updateContactSchema,
  updateMemberSchema,
} from "./businesses.validation.js";

export function createBusinessesRouter(controller: BusinessesController): Router {
  const router = Router();

  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("businesses:read"),
    validate(listBusinessesQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("businesses:create"),
    validate(createBusinessSchema),
    controller.create,
  );

  router.get("/:id", authenticateMiddleware, requirePermission("businesses:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("businesses:update"),
    validate(updateBusinessSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("businesses:delete"), controller.deleteById);

  router.post(
    "/:id/contacts",
    authenticateMiddleware,
    requirePermission("businesses:update"),
    validate(createContactSchema),
    controller.addContact,
  );
  router.patch(
    "/:id/contacts/:contactId",
    authenticateMiddleware,
    requirePermission("businesses:update"),
    validate(updateContactSchema),
    controller.updateContact,
  );
  router.delete(
    "/:id/contacts/:contactId",
    authenticateMiddleware,
    requirePermission("businesses:update"),
    controller.deleteContact,
  );

  router.get(
    "/:id/members",
    authenticateMiddleware,
    requirePermission("businesses:manage_members"),
    controller.listMembers,
  );
  router.post(
    "/:id/members",
    authenticateMiddleware,
    requirePermission("businesses:manage_members"),
    validate(addMemberSchema),
    controller.addMember,
  );
  router.patch(
    "/:id/members/:userId",
    authenticateMiddleware,
    requirePermission("businesses:manage_members"),
    validate(updateMemberSchema),
    controller.updateMember,
  );
  router.delete(
    "/:id/members/:userId",
    authenticateMiddleware,
    requirePermission("businesses:manage_members"),
    controller.removeMember,
  );

  return router;
}
