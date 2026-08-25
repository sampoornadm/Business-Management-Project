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
  businessId: string;
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
    businessId: notification.businessId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    entityType: notification.entityType,
    entityId: notification.entityId,
    isRead: notification.isRead,
    createdAt: notification.createdAt.toISOString(),
  };
}

export interface IBusinessMembershipLookup {
  listUserBusinesses(userId: string): Promise<Array<{ businessId: string }>>;
}

export class NotificationsService {
  constructor(
    private readonly notificationsRepository: INotificationsRepository,
    private readonly businessesRepository: IBusinessMembershipLookup,
  ) {}

  async create(data: CreateNotificationData): Promise<void> {
    await this.notificationsRepository.create(data);
  }

  async createMany(userIds: string[], payload: Omit<CreateNotificationData, "userId">): Promise<void> {
    const uniqueUserIds = [...new Set(userIds)];
    await this.notificationsRepository.createMany(
      uniqueUserIds.map((userId) => ({ userId, ...payload })),
    );
  }

  /**
   * `allBusinesses` is only honored against the caller's real `UserBusiness` rows — never the
   * client-sent business list — so a user can't see notifications from a business they've been
   * removed from just by passing a query flag.
   */
  private async resolveBusinessScope(
    userId: string,
    activeBusinessId: string,
    allBusinesses: boolean | undefined,
  ): Promise<string[]> {
    if (!allBusinesses) return [activeBusinessId];
    const memberships = await this.businessesRepository.listUserBusinesses(userId);
    return memberships.length > 0 ? memberships.map((m) => m.businessId) : [activeBusinessId];
  }

  async list(
    userId: string,
    activeBusinessId: string,
    allBusinesses: boolean | undefined,
    pagination: PaginationParams,
    filters: NotificationFilters,
  ): Promise<PaginatedResult<NotificationDto>> {
    const businessIds = await this.resolveBusinessScope(userId, activeBusinessId, allBusinesses);
    const { items, totalItems } = await this.notificationsRepository.findMany(
      userId,
      businessIds,
      pagination,
      filters,
    );
    return buildPaginatedResult(items.map(toDto), totalItems, pagination);
  }

  async getUnreadCount(userId: string, activeBusinessId: string): Promise<number> {
    return this.notificationsRepository.countUnread(userId, [activeBusinessId]);
  }

  async markRead(userId: string, businessId: string, notificationId: string): Promise<void> {
    const notification = await this.notificationsRepository.findById(notificationId, businessId);
    if (!notification) throw new NotFoundError("Notification not found");
    if (notification.userId !== userId) {
      throw new ForbiddenError("You cannot modify another user's notification");
    }
    await this.notificationsRepository.markRead(notificationId);
  }

  async markAllRead(
    userId: string,
    activeBusinessId: string,
    allBusinesses: boolean | undefined,
  ): Promise<void> {
    const businessIds = await this.resolveBusinessScope(userId, activeBusinessId, allBusinesses);
    await this.notificationsRepository.markAllRead(userId, businessIds);
  }

  async alreadyNotified(
    entityType: string,
    entityId: string,
    type: string,
    metadataMatch: Record<string, unknown>,
    businessId: string,
  ): Promise<boolean> {
    return this.notificationsRepository.existsForEntity(
      entityType,
      entityId,
      type,
      metadataMatch,
      businessId,
    );
  }
}
