import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { NotificationsService } from "./notifications.service.js";
import type { ListNotificationsQuery } from "./notifications.validation.js";

export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListNotificationsQuery;
    const pagination = resolvePagination(query);
    const result = await this.notificationsService.list(req.user!.id, pagination, {
      isRead: query.isRead,
    });
    sendSuccess(res, result, "Notifications retrieved");
  });

  unreadCount = asyncHandler(async (req, res) => {
    const count = await this.notificationsService.getUnreadCount(req.user!.id);
    sendSuccess(res, { count }, "Unread count retrieved");
  });

  markRead = asyncHandler(async (req, res) => {
    await this.notificationsService.markRead(req.user!.id, req.params.id!);
    sendSuccess(res, null, "Notification marked as read");
  });

  markAllRead = asyncHandler(async (req, res) => {
    await this.notificationsService.markAllRead(req.user!.id);
    sendSuccess(res, null, "All notifications marked as read");
  });
}
