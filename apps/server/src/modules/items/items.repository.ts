import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";
import type { ListItemsQuery } from "@bmp/types";

const itemArgs = {
  select: {
    id: true,
    canonicalName: true,
    unit: true,
    categoryId: true,
    categoryConfirmed: true,
    aiConfidence: true,
  },
} satisfies Prisma.ItemDefaultArgs;

export type ItemRow = Prisma.ItemGetPayload<typeof itemArgs>;

export interface UnlinkedRfqItem {
  id: string;
  description: string;
  unit: string | null;
  boqItemId: string | null;
}

export interface BoqNameRow {
  id: string;
  normalizedName: string | null;
  unit: string | null;
}

export interface ItemQuoteRow {
  itemId: string;
  rate: number;
  vendorId: string;
  quotedAt: Date;
}

export interface ItemForClassify {
  id: string;
  canonicalName: string;
  unit: string | null;
  embedding: number[];
  embeddedAt: Date | null;
}

export interface ConfirmedMatchRow {
  id: string;
  categoryId: string;
  canonicalName: string;
  unit: string | null;
  embedding: number[];
  embeddedAt: Date | null;
}

type ItemStatus = NonNullable<ListItemsQuery["status"]>;

function statusWhere(status: ItemStatus | undefined): Prisma.ItemWhereInput {
  switch (status) {
    case "unclassified":
      return { categoryId: null };
    case "unconfirmed":
      return { categoryId: { not: null }, categoryConfirmed: false };
    case "classified":
      return { categoryConfirmed: true };
    default:
      return {};
  }
}

export interface IItemsRepository {
  findUnlinkedRfqItems(businessId: string): Promise<UnlinkedRfqItem[]>;
  findBoqNames(ids: string[]): Promise<BoqNameRow[]>;
  findOrCreateItem(businessId: string, canonicalName: string, unit: string | null): Promise<{ id: string }>;
  linkRfqItems(itemId: string, rfqItemIds: string[]): Promise<void>;
  findItems(businessId: string, search: string | undefined, status: ItemStatus | undefined): Promise<ItemRow[]>;
  findQuoteRowsForItems(itemIds: string[]): Promise<ItemQuoteRow[]>;
  findById(id: string, businessId: string): Promise<ItemRow | null>;
  updateCategory(id: string, categoryId: string | null, confirmed: boolean, aiConfidence: number | null): Promise<void>;
  findUnclassified(businessId: string, limit: number): Promise<ItemForClassify[]>;
  countUnclassified(businessId: string): Promise<number>;
  getForClassify(id: string, businessId: string): Promise<ItemForClassify | null>;
  setEmbedding(id: string, embedding: number[]): Promise<void>;
  findConfirmedForMatch(businessId: string): Promise<ConfirmedMatchRow[]>;
}

export class ItemsRepository implements IItemsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findUnlinkedRfqItems(businessId: string): Promise<UnlinkedRfqItem[]> {
    return this.prisma.rfqItem.findMany({
      where: { itemId: null, rfq: { businessId } },
      select: { id: true, description: true, unit: true, boqItemId: true },
    });
  }

  findBoqNames(ids: string[]): Promise<BoqNameRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.boqItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, normalizedName: true, unit: true },
    });
  }

  findOrCreateItem(businessId: string, canonicalName: string, unit: string | null): Promise<{ id: string }> {
    // Upsert is race-safe: two concurrent backfills converge on the one row.
    return this.prisma.item.upsert({
      where: { businessId_canonicalName: { businessId, canonicalName } },
      create: { id: randomUUID(), businessId, canonicalName, unit },
      update: {},
      select: { id: true },
    });
  }

  async linkRfqItems(itemId: string, rfqItemIds: string[]): Promise<void> {
    await this.prisma.rfqItem.updateMany({ where: { id: { in: rfqItemIds } }, data: { itemId } });
  }

  findItems(businessId: string, search: string | undefined, status: ItemStatus | undefined): Promise<ItemRow[]> {
    return this.prisma.item.findMany({
      where: {
        businessId,
        ...statusWhere(status),
        ...(search ? { canonicalName: { contains: search, mode: "insensitive" } } : {}),
      },
      ...itemArgs,
    });
  }

  async findQuoteRowsForItems(itemIds: string[]): Promise<ItemQuoteRow[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.prisma.rfqQuote.findMany({
      where: { regretted: false, rate: { not: null }, rfqItem: { itemId: { in: itemIds } } },
      select: { rate: true, vendorId: true, quotedAt: true, rfqItem: { select: { itemId: true } } },
    });
    return rows.map((r) => ({
      itemId: r.rfqItem.itemId!,
      rate: r.rate!,
      vendorId: r.vendorId,
      quotedAt: r.quotedAt,
    }));
  }

  findById(id: string, businessId: string): Promise<ItemRow | null> {
    return this.prisma.item.findFirst({ where: { id, businessId }, ...itemArgs });
  }

  async updateCategory(
    id: string,
    categoryId: string | null,
    confirmed: boolean,
    aiConfidence: number | null,
  ): Promise<void> {
    await this.prisma.item.update({
      where: { id },
      data: { categoryId, categoryConfirmed: confirmed, aiConfidence },
    });
  }

  findUnclassified(businessId: string, limit: number): Promise<ItemForClassify[]> {
    return this.prisma.item.findMany({
      where: { businessId, categoryId: null },
      take: limit,
      select: { id: true, canonicalName: true, unit: true, embedding: true, embeddedAt: true },
    });
  }

  countUnclassified(businessId: string): Promise<number> {
    return this.prisma.item.count({ where: { businessId, categoryId: null } });
  }

  getForClassify(id: string, businessId: string): Promise<ItemForClassify | null> {
    return this.prisma.item.findFirst({
      where: { id, businessId },
      select: { id: true, canonicalName: true, unit: true, embedding: true, embeddedAt: true },
    });
  }

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.prisma.item.update({ where: { id }, data: { embedding, embeddedAt: new Date() } });
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$executeRaw`UPDATE items SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
  }

  findConfirmedForMatch(businessId: string): Promise<ConfirmedMatchRow[]> {
    return this.prisma.item.findMany({
      where: { businessId, categoryConfirmed: true, categoryId: { not: null } },
      select: { id: true, categoryId: true, canonicalName: true, unit: true, embedding: true, embeddedAt: true },
    }) as Promise<ConfirmedMatchRow[]>;
  }
}
