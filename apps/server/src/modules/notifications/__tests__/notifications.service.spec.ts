import { randomUUID } from "node:crypto";

import type { Notification } from "@bmp/database";
import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type {
  CreateNotificationData,
  INotificationsRepository,
  NotificationFilters,
} from "../notifications.repository.js";
import { NotificationsService, type IBusinessMembershipLookup } from "../notifications.service.js";

class FakeNotificationsRepository implements INotificationsRepository {
  notifications = new Map<string, Notification>();

  async create(data: CreateNotificationData): Promise<Notification> {
    const notification = {
      id: randomUUID(),
      userId: data.userId,
      businessId: data.businessId,
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

  async findById(id: string, businessId: string): Promise<Notification | null> {
    const notification = this.notifications.get(id);
    return notification && notification.businessId === businessId ? notification : null;
  }

  async findMany(
    userId: string,
    businessIds: string[],
    pagination: { page: number; pageSize: number },
    filters: NotificationFilters,
  ) {
    const items = [...this.notifications.values()].filter(
      (n) =>
        n.userId === userId &&
        businessIds.includes(n.businessId) &&
        (filters.isRead === undefined || n.isRead === filters.isRead),
    );
    return { items, totalItems: items.length };
  }

  async countUnread(userId: string, businessIds: string[]): Promise<number> {
    return [...this.notifications.values()].filter(
      (n) => n.userId === userId && businessIds.includes(n.businessId) && !n.isRead,
    ).length;
  }

  async markRead(id: string): Promise<void> {
    const notification = this.notifications.get(id);
    if (notification) notification.isRead = true;
  }

  async markAllRead(userId: string, businessIds: string[]): Promise<void> {
    for (const notification of this.notifications.values()) {
      if (notification.userId === userId && businessIds.includes(notification.businessId)) {
        notification.isRead = true;
      }
    }
  }

  async existsForEntity(): Promise<boolean> {
    return false;
  }
}

class FakeBusinessMembershipLookup implements IBusinessMembershipLookup {
  memberships = new Map<string, string[]>();

  async listUserBusinesses(userId: string): Promise<Array<{ businessId: string }>> {
    return (this.memberships.get(userId) ?? []).map((businessId) => ({ businessId }));
  }
}

describe("NotificationsService", () => {
  let repository: FakeNotificationsRepository;
  let memberships: FakeBusinessMembershipLookup;
  let service: NotificationsService;
  const userA = randomUUID();
  const userB = randomUUID();
  const businessX = randomUUID();
  const businessY = randomUUID();

  beforeEach(() => {
    repository = new FakeNotificationsRepository();
    memberships = new FakeBusinessMembershipLookup();
    service = new NotificationsService(repository, memberships);
  });

  it("creates and lists a user's notifications", async () => {
    await service.create({ userId: userA, businessId: businessX, type: "TEST", title: "Hello" });
    const result = await service.list(userA, businessX, undefined, { page: 1, pageSize: 20 }, {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("Hello");
  });

  it("fans out createMany to multiple users, deduped", async () => {
    await service.createMany([userA, userB, userA], { businessId: businessX, type: "TEST", title: "Fanout" });
    expect(await service.getUnreadCount(userA, businessX)).toBe(1);
    expect(await service.getUnreadCount(userB, businessX)).toBe(1);
  });

  it("allows a user to mark their own notification read", async () => {
    const created = await repository.create({ userId: userA, businessId: businessX, type: "TEST", title: "Mine" });
    await service.markRead(userA, businessX, created.id);
    expect(await service.getUnreadCount(userA, businessX)).toBe(0);
  });

  it("rejects marking another user's notification as read", async () => {
    const created = await repository.create({ userId: userA, businessId: businessX, type: "TEST", title: "Mine" });
    await expect(service.markRead(userB, businessX, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a missing notification", async () => {
    await expect(service.markRead(userA, businessX, randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when marking a notification read from a different business", async () => {
    const created = await repository.create({ userId: userA, businessId: businessX, type: "TEST", title: "Mine" });
    await expect(service.markRead(userA, businessY, created.id)).rejects.toThrow(NotFoundError);
  });

  it("marks all of a user's notifications read without affecting others", async () => {
    await service.createMany([userA], { businessId: businessX, type: "TEST", title: "One" });
    await service.createMany([userA], { businessId: businessX, type: "TEST", title: "Two" });
    await service.createMany([userB], { businessId: businessX, type: "TEST", title: "Other" });

    await service.markAllRead(userA, businessX, undefined);

    expect(await service.getUnreadCount(userA, businessX)).toBe(0);
    expect(await service.getUnreadCount(userB, businessX)).toBe(1);
  });

  it("scopes the default list to only the active business", async () => {
    await service.create({ userId: userA, businessId: businessX, type: "TEST", title: "In X" });
    await service.create({ userId: userA, businessId: businessY, type: "TEST", title: "In Y" });

    const result = await service.list(userA, businessX, undefined, { page: 1, pageSize: 20 }, {});
    expect(result.items.map((n) => n.title)).toEqual(["In X"]);
  });

  it("ignores allBusinesses unless the caller actually belongs to more than one business", async () => {
    await service.create({ userId: userA, businessId: businessX, type: "TEST", title: "In X" });
    await service.create({ userId: userA, businessId: businessY, type: "TEST", title: "In Y" });
    // userA has no real UserBusiness membership rows registered in the fake lookup —
    // asking for allBusinesses must not leak business Y's notification anyway.

    const result = await service.list(userA, businessX, true, { page: 1, pageSize: 20 }, {});
    expect(result.items.map((n) => n.title)).toEqual(["In X"]);
  });

  it("returns notifications across every business the caller is actually a member of when allBusinesses is set", async () => {
    memberships.memberships.set(userA, [businessX, businessY]);
    await service.create({ userId: userA, businessId: businessX, type: "TEST", title: "In X" });
    await service.create({ userId: userA, businessId: businessY, type: "TEST", title: "In Y" });

    const result = await service.list(userA, businessX, true, { page: 1, pageSize: 20 }, {});
    expect(result.items.map((n) => n.title).sort()).toEqual(["In X", "In Y"]);
  });
});
