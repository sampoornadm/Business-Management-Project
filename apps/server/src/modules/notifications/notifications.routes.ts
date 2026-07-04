import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { NotificationsController } from "./notifications.controller.js";
import { listNotificationsQuerySchema } from "./notifications.validation.js";

export function createNotificationsRouter(controller: NotificationsController): Router {
  const router = Router();

  /**
   * @openapi
   * /notifications:
   *   get:
   *     tags: [Notifications]
   *     summary: List the current user's notifications
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated notifications }
   */
  router.get(
    "/",
    authenticateMiddleware,
    validate(listNotificationsQuerySchema, "query"),
    controller.list,
  );

  /**
   * @openapi
   * /notifications/unread-count:
   *   get:
   *     tags: [Notifications]
   *     summary: Get the current user's unread notification count
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Unread count }
   */
  router.get("/unread-count", authenticateMiddleware, controller.unreadCount);

  /**
   * @openapi
   * /notifications/read-all:
   *   patch:
   *     tags: [Notifications]
   *     summary: Mark all of the current user's notifications as read
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: All notifications marked as read }
   */
  router.patch("/read-all", authenticateMiddleware, controller.markAllRead);

  /**
   * @openapi
   * /notifications/{id}/read:
   *   patch:
   *     tags: [Notifications]
   *     summary: Mark one notification as read
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Notification marked as read }
   */
  router.patch("/:id/read", authenticateMiddleware, controller.markRead);

  return router;
}
