import { randomUUID } from "node:crypto";

import type { Notification } from "@bmp/database";
import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type {
  CreateNotificationData,
  INotificationsRepository,
  NotificationFilters,
} from "../notifications.repository.js";
import { NotificationsService } from "../notifications.service.js";

class FakeNotificationsRepository implements INotificationsRepository {
  notifications = new Map<string, Notification>();

  async create(data: CreateNotificationData): Promise<Notification> {
    const notification = {
      id: randomUUID(),
      userId: data.userId,
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      isRead: false,
      readAt: null,
      metadata: data.metadata ?? null,
      createdAt: new Date(),
    } as Notification;
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async createMany(data: CreateNotificationData[]): Promise<void> {
    for (const item of data) await this.create(item);
  }

  async findById(id: string): Promise<Notification | null> {
    return this.notifications.get(id) ?? null;
  }

  async findMany(userId: string, pagination: { page: number; pageSize: number }, filters: NotificationFilters) {
    const items = [...this.notifications.values()].filter(
      (n) => n.userId === userId && (filters.isRead === undefined || n.isRead === filters.isRead),
    );
    return { items, totalItems: items.length };
  }

  async countUnread(userId: string): Promise<number> {
    return [...this.notifications.values()].filter((n) => n.userId === userId && !n.isRead).length;
  }

  async markRead(id: string): Promise<void> {
    const notification = this.notifications.get(id);
    if (notification) notification.isRead = true;
  }

  async markAllRead(userId: string): Promise<void> {
    for (const notification of this.notifications.values()) {
      if (notification.userId === userId) notification.isRead = true;
    }
  }

  async existsForEntity(): Promise<boolean> {
    return false;
  }
}

describe("NotificationsService", () => {
  let repository: FakeNotificationsRepository;
  let service: NotificationsService;
  const userA = randomUUID();
  const userB = randomUUID();

  beforeEach(() => {
    repository = new FakeNotificationsRepository();
    service = new NotificationsService(repository);
  });

  it("creates and lists a user's notifications", async () => {
    await service.create({ userId: userA, type: "TEST", title: "Hello" });
    const result = await service.list(userA, { page: 1, pageSize: 20 }, {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("Hello");
  });

  it("fans out createMany to multiple users, deduped", async () => {
    await service.createMany([userA, userB, userA], { type: "TEST", title: "Fanout" });
    expect(await service.getUnreadCount(userA)).toBe(1);
    expect(await service.getUnreadCount(userB)).toBe(1);
  });

  it("allows a user to mark their own notification read", async () => {
    const created = await repository.create({ userId: userA, type: "TEST", title: "Mine" });
    await service.markRead(userA, created.id);
    expect(await service.getUnreadCount(userA)).toBe(0);
  });

  it("rejects marking another user's notification as read", async () => {
    const created = await repository.create({ userId: userA, type: "TEST", title: "Mine" });
    await expect(service.markRead(userB, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a missing notification", async () => {
    await expect(service.markRead(userA, randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("marks all of a user's notifications read without affecting others", async () => {
    await service.createMany([userA], { type: "TEST", title: "One" });
    await service.createMany([userA], { type: "TEST", title: "Two" });
    await service.createMany([userB], { type: "TEST", title: "Other" });

    await service.markAllRead(userA);

    expect(await service.getUnreadCount(userA)).toBe(0);
    expect(await service.getUnreadCount(userB)).toBe(1);
  });
});
