import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, SavedView } from "@bmp/database";
import type { FilterCondition } from "@bmp/types";

export interface CreateSavedViewData {
  userId: string;
  businessId: string;
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}

export type UpdateSavedViewData = Partial<Omit<CreateSavedViewData, "userId" | "businessId" | "pageKey">>;

export interface ISavedViewsRepository {
  findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]>;
  findById(id: string, businessId: string): Promise<SavedView | null>;
  create(data: CreateSavedViewData): Promise<SavedView>;
  update(id: string, data: UpdateSavedViewData): Promise<SavedView>;
  delete(id: string): Promise<void>;
}

export class SavedViewsRepository implements ISavedViewsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(userId: string, businessId: string, pageKey: string): Promise<SavedView[]> {
    return this.prisma.savedView.findMany({
      where: { userId, businessId, pageKey },
      orderBy: { createdAt: "asc" },
    });
  }

  findById(id: string, businessId: string): Promise<SavedView | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key filtered here —
    // businessId must also match, and there's no compound (id, businessId) unique constraint.
    return this.prisma.savedView.findFirst({ where: { id, businessId } });
  }

  create(data: CreateSavedViewData): Promise<SavedView> {
    return this.prisma.savedView.create({
      data: {
        id: randomUUID(),
        userId: data.userId,
        businessId: data.businessId,
        pageKey: data.pageKey,
        name: data.name,
        filters: data.filters as unknown as Prisma.InputJsonValue,
        visibleColumns: data.visibleColumns as unknown as Prisma.InputJsonValue,
        columnOrder: data.columnOrder as unknown as Prisma.InputJsonValue,
        sortBy: data.sortBy ?? null,
        sortDir: data.sortDir ?? null,
      },
    });
  }

  update(id: string, data: UpdateSavedViewData): Promise<SavedView> {
    return this.prisma.savedView.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.filters !== undefined
          ? { filters: data.filters as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.visibleColumns !== undefined
          ? { visibleColumns: data.visibleColumns as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.columnOrder !== undefined
          ? { columnOrder: data.columnOrder as unknown as Prisma.InputJsonValue }
          : {}),
        ...(data.sortBy !== undefined ? { sortBy: data.sortBy } : {}),
        ...(data.sortDir !== undefined ? { sortDir: data.sortDir } : {}),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.savedView.delete({ where: { id } });
  }
}
