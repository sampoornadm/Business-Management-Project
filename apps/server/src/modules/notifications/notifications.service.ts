import type { NotificationDto, PaginatedResult } from "@bmp/types";

import { ForbiddenError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";

import type {
  CreateNotificationData,
  INotificationsRepository,
  NotificationFilters,
} from "./notifications.repository.js";

function toDto(notification: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: Date;
}): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    entityType: notification.entityType,
    entityId: notification.entityId,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  };
}

export class NotificationsService {
  constructor(private readonly notificationsRepository: INotificationsRepository) {}

  async create(data: CreateNotificationData): Promise<void> {
    await this.notificationsRepository.create(data);
  }

  async createMany(userIds: string[], payload: Omit<CreateNotificationData, "userId">): Promise<void> {
    const uniqueUserIds = [...new Set(userIds)];
    await this.notificationsRepository.createMany(
      uniqueUserIds.map((userId) => ({ userId, ...payload })),
    );
  }

  async list(
    userId: string,
    pagination: PaginationParams,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<NotificationDto>> {
    const { items, totalItems } = await this.notificationsRepository.findMany(
      userId,
      pagination,
      filters,
    );
    return buildPaginatedResult(items.map(toDto), totalItems, pagination);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationsRepository.countUnread(userId);
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const notification = await this.notificationsRepository.findById(notificationId);
    if (!notification) throw new NotFoundError("Notification not found");
    if (notification.userId !== userId) {
      throw new ForbiddenError("You cannot modify another user's notification");
    }
    await this.notificationsRepository.markRead(notificationId);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationsRepository.markAllRead(userId);
  }

  async alreadyNotified(
    entityType: string,
    entityId: string,
    type: string,
    metadataMatch: Record<string, unknown>,
  ): Promise<boolean> {
    return this.notificationsRepository.existsForEntity(entityType, entityId, type, metadataMatch);
  }
}
