import { randomUUID } from "node:crypto";

import type { PrismaClient, Tag } from "@bmp/database";

export interface CreateTagData {
  name: string;
  color?: string | null;
}

export type UpdateTagData = Partial<CreateTagData>;

export interface ITagsRepository {
  findAll(): Promise<Tag[]>;
  findById(id: string): Promise<Tag | null>;
  findByName(name: string): Promise<Tag | null>;
  create(data: CreateTagData): Promise<Tag>;
  update(id: string, data: UpdateTagData): Promise<Tag>;
  delete(id: string): Promise<void>;
}

export class TagsRepository implements ITagsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<Tag[]> {
    return this.prisma.tag.findMany({ orderBy: { name: "asc" } });
  }

  findById(id: string): Promise<Tag | null> {
    return this.prisma.tag.findUnique({ where: { id } });
  }

  findByName(name: string): Promise<Tag | null> {
    return this.prisma.tag.findUnique({ where: { name } });
  }

  create(data: CreateTagData): Promise<Tag> {
    return this.prisma.tag.create({ data: { id: randomUUID(), ...data } });
  }

  update(id: string, data: UpdateTagData): Promise<Tag> {
    return this.prisma.tag.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tag.delete({ where: { id } });
  }
}
