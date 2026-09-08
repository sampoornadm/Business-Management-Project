import { randomUUID } from "node:crypto";

import type { SavedView } from "@bmp/database";
import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { CreateSavedViewData, ISavedViewsRepository, UpdateSavedViewData } from "../saved-views.repository.js";
import { SavedViewsService } from "../saved-views.service.js";

class FakeSavedViewsRepository implements ISavedViewsRepository {
  views = new Map<string, SavedView>();

  async findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]> {
    return [...this.views.values()].filter(
      (v) => v.userId === userId && v.businessId === businessId && v.pageKey === pageKey,
    );
  }

  async findById(id: string, businessId: string): Promise<SavedView | null> {
    const view = this.views.get(id);
    return view && view.businessId === businessId ? view : null;
  }

  async create(data: CreateSavedViewData): Promise<SavedView> {
    const now = new Date();
    const view = {
      id: randomUUID(),
      userId: data.userId,
      businessId: data.businessId,
      pageKey: data.pageKey,
      name: data.name,
      filters: data.filters,
      visibleColumns: data.visibleColumns,
      columnOrder: data.columnOrder,
      sortBy: data.sortBy ?? null,
      sortDir: data.sortDir ?? null,
      createdAt: now,
      updatedAt: now,
    } as unknown as SavedView;
    this.views.set(view.id, view);
    return view;
  }

  async update(id: string, data: UpdateSavedViewData): Promise<SavedView> {
    const view = this.views.get(id);
    if (!view) throw new Error("not found");
    const updated = { ...view, ...data, updatedAt: new Date() } as SavedView;
    this.views.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.views.delete(id);
  }
}

describe("SavedViewsService", () => {
  let repository: FakeSavedViewsRepository;
  let service: SavedViewsService;
  const userA = randomUUID();
  const userB = randomUUID();
  const businessX = randomUUID();
  const businessY = randomUUID();

  beforeEach(() => {
    repository = new FakeSavedViewsRepository();
    service = new SavedViewsService(repository);
  });

  it("lists only the caller's own views for the given page", async () => {
    await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });
    await service.create({
      userId: userB,
      businessId: businessX,
      pageKey: "tenders",
      name: "Not mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    const views = await service.list(userA, businessX, "tenders");
    expect(views).toHaveLength(1);
    expect(views[0]!.name).toBe("Mine");
  });

  it("allows the owner to update their own view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    const updated = await service.update(created.id, userA, businessX, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
  });

  it("rejects updating another user's view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.update(created.id, userB, businessX, { name: "Hijacked" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("throws NotFoundError for a missing view", async () => {
    await expect(service.update(randomUUID(), userA, businessX, { name: "X" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws NotFoundError when the view belongs to a different business", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.update(created.id, userA, businessY, { name: "X" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("allows the owner to delete their own view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await service.delete(created.id, userA, businessX);
    expect(await service.list(userA, businessX, "tenders")).toHaveLength(0);
  });

  it("rejects deleting another user's view", async () => {
    const created = await service.create({
      userId: userA,
      businessId: businessX,
      pageKey: "tenders",
      name: "Mine",
      filters: [],
      visibleColumns: [],
      columnOrder: [],
    });

    await expect(service.delete(created.id, userB, businessX)).rejects.toThrow(ForbiddenError);
  });
});
