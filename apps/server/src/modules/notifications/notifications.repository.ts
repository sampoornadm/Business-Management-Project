import { randomUUID } from "node:crypto";

import type { Notification, Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

export interface CreateNotificationData {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface NotificationFilters {
  isRead?: boolean;
}

export interface INotificationsRepository {
  create(data: CreateNotificationData): Promise<Notification>;
  createMany(data: CreateNotificationData[]): Promise<void>;
  findById(id: string): Promise<Notification | null>;
  findMany(
    userId: string,
    pagination: PaginationParams,
    filters: NotificationFilters,
  ): Promise<{ items: Notification[]; totalItems: number }>;
  countUnread(userId: string): Promise<number>;
  markRead(id: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  existsForEntity(entityType: string, entityId: string, type: string, metadataMatch: Record<string, unknown>): Promise<boolean>;
}

export class NotificationsRepository implements INotificationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateNotificationData): Promise<Notification> {
    return this.prisma.notification.create({ data: { id: randomUUID(), ...data } });
  }

  async createMany(data: CreateNotificationData[]): Promise<void> {
    if (data.length === 0) return;
    await this.prisma.notification.createMany({
      data: data.map((item) => ({ id: randomUUID(), ...item })),
    });
  }

  findById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findUnique({ where: { id } });
  }

  async findMany(
    userId: string,
    pagination: PaginationParams,
    filters: NotificationFilters,
  ): Promise<{ items: Notification[]; totalItems: number }> {
    const where: Prisma.NotificationWhereInput = { userId, isRead: filters.isRead };

    const [items, totalItems] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, totalItems };
  }

  countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async existsForEntity(
    entityType: string,
    entityId: string,
    type: string,
    metadataMatch: Record<string, unknown>,
  ): Promise<boolean> {
    const candidates = await this.prisma.notification.findMany({
      where: { entityType, entityId, type },
      select: { metadata: true },
    });
    return candidates.some((c) => {
      const metadata = (c.metadata ?? {}) as Record<string, unknown>;
      return Object.entries(metadataMatch).every(([key, value]) => metadata[key] === value);
    });
  }
}
