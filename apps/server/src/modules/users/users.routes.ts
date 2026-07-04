import { Router } from "express";

import { AVATAR_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { UsersController } from "./users.controller.js";
import {
  assignRoleSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateOwnProfileSchema,
  updateUserSchema,
} from "./users.validation.js";

export function createUsersRouter(controller: UsersController): Router {
  const router = Router();
  const uploadAvatar = createUploadMiddleware(
    "avatar",
    AVATAR_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    AVATAR_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /users/me:
   *   get:
   *     tags: [Users]
   *     summary: Get the current authenticated user's profile
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Current user }
   *   patch:
   *     tags: [Users]
   *     summary: Update the current user's own profile
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated profile }
   */
  router.get("/me", authenticateMiddleware, controller.getMe);
  router.patch("/me", authenticateMiddleware, validate(updateOwnProfileSchema), controller.updateMe);

  /**
   * @openapi
   * /users/me/avatar:
   *   post:
   *     tags: [Users]
   *     summary: Upload the current user's avatar
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               avatar: { type: string, format: binary }
   *     responses:
   *       200: { description: Avatar uploaded }
   */
  router.post("/me/avatar", authenticateMiddleware, uploadAvatar, controller.uploadAvatar);

  /**
   * @openapi
   * /users:
   *   get:
   *     tags: [Users]
   *     summary: List users (paginated, searchable)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated list of users }
   *   post:
   *     tags: [Users]
   *     summary: Create a new user (sends an invite email)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: User created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("users:read"),
    validate(listUsersQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("users:create"),
    validate(createUserSchema),
    controller.create,
  );

  /**
   * @openapi
   * /users/{id}:
   *   get:
   *     tags: [Users]
   *     summary: Get a user by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: User }
   *   patch:
   *     tags: [Users]
   *     summary: Update a user
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated user }
   *   delete:
   *     tags: [Users]
   *     summary: Deactivate a user
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: User deactivated }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("users:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("users:update"),
    validate(updateUserSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("users:delete"), controller.deactivate);

  /**
   * @openapi
   * /users/{id}/role:
   *   patch:
   *     tags: [Users]
   *     summary: Assign a role to a user
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Role assigned }
   */
  router.patch(
    "/:id/role",
    authenticateMiddleware,
    requirePermission("users:assign_role"),
    validate(assignRoleSchema),
    controller.assignRole,
  );

  return router;
}
