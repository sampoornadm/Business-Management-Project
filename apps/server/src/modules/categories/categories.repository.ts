import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

const categoryArgs = {
  select: { id: true, parentId: true, name: true, sortOrder: true },
} satisfies Prisma.CategoryDefaultArgs;

export type CategoryRow = Prisma.CategoryGetPayload<typeof categoryArgs>;

export interface CreateCategoryData {
  parentId: string | null;
  name: string;
  sortOrder: number;
}

export interface UpdateCategoryData {
  name?: string;
  sortOrder?: number;
}

export interface ICategoriesRepository {
  findAll(): Promise<CategoryRow[]>;
  findById(id: string): Promise<CategoryRow | null>;
  findByParentAndName(parentId: string | null, name: string): Promise<CategoryRow | null>;
  create(data: CreateCategoryData): Promise<CategoryRow>;
  update(id: string, data: UpdateCategoryData): Promise<CategoryRow>;
  delete(id: string): Promise<void>;
}

export class CategoriesRepository implements ICategoriesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<CategoryRow[]> {
    return this.prisma.category.findMany({
      ...categoryArgs,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  findById(id: string): Promise<CategoryRow | null> {
    return this.prisma.category.findUnique({ where: { id }, ...categoryArgs });
  }

  findByParentAndName(parentId: string | null, name: string): Promise<CategoryRow | null> {
    return this.prisma.category.findFirst({ where: { parentId, name }, ...categoryArgs });
  }

  create(data: CreateCategoryData): Promise<CategoryRow> {
    return this.prisma.category.create({ data: { id: randomUUID(), ...data }, ...categoryArgs });
  }

  update(id: string, data: UpdateCategoryData): Promise<CategoryRow> {
    return this.prisma.category.update({ where: { id }, data, ...categoryArgs });
  }

  async delete(id: string): Promise<void> {
    // Children cascade (schema onDelete: Cascade); items using it get categoryId nulled
    // (onDelete: SetNull) — a deleted category quietly unclassifies its items, never errors.
    await this.prisma.category.delete({ where: { id } });
  }
}
