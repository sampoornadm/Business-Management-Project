import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";
import type { FilterCondition, ListItemsQuery } from "@bmp/types";

import { buildPrismaFilterWhere } from "../../shared/utils/filtering.js";

import { deriveFamilyKey, formatItemCode, headingPrefix, parseItemCode } from "./item-code.js";
import { ITEM_FILTER_COLUMNS } from "./items.filter-columns.js";

const itemArgs = {
  select: {
    id: true,
    canonicalName: true,
    itemCode: true,
    unit: true,
    categoryId: true,
    categoryConfirmed: true,
    aiConfidence: true,
    needsReview: true,
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

/** A ranked ANN result — flat, no `embedding`/`embeddedAt`, since nothing downstream needs them. */
export interface NearestConfirmedMatch {
  id: string;
  categoryId: string;
  canonicalName: string;
  unit: string | null;
  similarity: number;
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
    case "needs_review":
      return { needsReview: true };
    default:
      return {};
  }
}

export interface IItemsRepository {
  findUnlinkedRfqItems(businessId: string): Promise<UnlinkedRfqItem[]>;
  findBoqNames(ids: string[]): Promise<BoqNameRow[]>;
  findOrCreateItem(businessId: string, canonicalName: string, unit: string | null): Promise<{ id: string }>;
  linkRfqItems(itemId: string, rfqItemIds: string[]): Promise<void>;
  findConfirmedHsn(businessId: string, canonicalName: string): Promise<{ hsnCode: string; gstRate: number | null } | null>;
  confirmItemHsn(
    businessId: string,
    canonicalName: string,
    unit: string | null,
    hsnCode: string,
    gstRate: number,
  ): Promise<{ id: string; propagated: boolean }>;
  findItems(
    businessId: string,
    search: string | undefined,
    status: ItemStatus | undefined,
    filters?: FilterCondition[],
  ): Promise<ItemRow[]>;
  findQuoteRowsForItems(itemIds: string[]): Promise<ItemQuoteRow[]>;
  findById(id: string, businessId: string): Promise<ItemRow | null>;
  findByCanonicalName(businessId: string, canonicalName: string): Promise<{ id: string } | null>;
  renameItem(id: string, canonicalName: string): Promise<void>;
  updateCategory(
    id: string,
    categoryId: string | null,
    confirmed: boolean,
    aiConfidence: number | null,
    needsReview: boolean,
  ): Promise<void>;
  findUnclassified(businessId: string, limit: number): Promise<ItemForClassify[]>;
  countUnclassified(businessId: string): Promise<number>;
  getForClassify(id: string, businessId: string): Promise<ItemForClassify | null>;
  setEmbedding(id: string, embedding: number[]): Promise<void>;
  findConfirmedForMatch(businessId: string): Promise<ConfirmedMatchRow[]>;
  findNearestConfirmedMatch(
    businessId: string,
    excludeItemId: string,
    queryVector: number[],
    limit: number,
  ): Promise<NearestConfirmedMatch[]>;
  /** Nearest Items whose HSN a human has confirmed — the feedback pool for near-name suggestions. */
  findNearestConfirmedHsn(businessId: string, queryVector: number[], limit: number): Promise<NearestConfirmedHsn[]>;
  /** Confirmed-HSN Items in the same family (same name minus numbers), for a deterministic match. */
  findConfirmedHsnByFamily(businessId: string, familyKey: string): Promise<ConfirmedHsnNeighbour[]>;
  /** Confirmed-HSN Items with no embedding yet — embedded lazily so they join the feedback pool. */
  findConfirmedHsnUnembedded(businessId: string): Promise<{ id: string; canonicalName: string }[]>;
  /** Assigns the Item's internal code if it has none, and refreshes its HSN-heading prefix. */
  ensureItemCode(itemId: string): Promise<string>;
}

export interface ConfirmedHsnNeighbour {
  canonicalName: string;
  hsnCode: string;
  gstRate: number | null;
}

export interface NearestConfirmedHsn extends ConfirmedHsnNeighbour {
  similarity: number;
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
    return this.prisma.item
      .upsert({
        where: { businessId_canonicalName: { businessId, canonicalName } },
        create: { id: randomUUID(), businessId, canonicalName, unit },
        update: {},
        select: { id: true },
      })
      .then(async (item) => {
        await this.ensureItemCode(item.id);
        return item;
      });
  }

  async linkRfqItems(itemId: string, rfqItemIds: string[]): Promise<void> {
    await this.prisma.rfqItem.updateMany({ where: { id: { in: rfqItemIds } }, data: { itemId } });
  }

  async findConfirmedHsn(
    businessId: string,
    canonicalName: string,
  ): Promise<{ hsnCode: string; gstRate: number | null } | null> {
    const item = await this.prisma.item.findUnique({
      where: { businessId_canonicalName: { businessId, canonicalName } },
      select: { hsnCode: true, gstRate: true, hsnCodeConfirmed: true },
    });
    if (!item?.hsnCodeConfirmed || item.hsnCode === null) return null;
    // A confirmed HSN code with no rate means exactly that. Defaulting it to 18 here made an
    // absent rate indistinguishable from a human-confirmed 18%, so callers fall back to the
    // lookup sheet instead.
    return { hsnCode: item.hsnCode, gstRate: item.gstRate };
  }

  /**
   * Find-or-create the canonical Item (same identity rule as findOrCreateItem), then write the
   * HSN/GST fact onto it only if a human hasn't already confirmed one — a later BoqItem must
   * never clobber an earlier estimator's confirmed catalog entry. Returns propagated=false when
   * this call was a no-op (an already-confirmed Item), so the caller can skip audit-logging it.
   */
  async confirmItemHsn(
    businessId: string,
    canonicalName: string,
    unit: string | null,
    hsnCode: string,
    gstRate: number,
  ): Promise<{ id: string; propagated: boolean }> {
    const item = await this.prisma.item.upsert({
      where: { businessId_canonicalName: { businessId, canonicalName } },
      create: { id: randomUUID(), businessId, canonicalName, unit },
      update: {},
      select: { id: true, hsnCodeConfirmed: true },
    });
    if (item.hsnCodeConfirmed) return { id: item.id, propagated: false };
    await this.prisma.item.update({
      where: { id: item.id },
      data: { hsnCode, gstRate, hsnCodeConfirmed: true },
    });
    await this.ensureItemCode(item.id);
    return { id: item.id, propagated: true };
  }

  findItems(
    businessId: string,
    search: string | undefined,
    status: ItemStatus | undefined,
    filters: FilterCondition[] = [],
  ): Promise<ItemRow[]> {
    const baseWhere: Prisma.ItemWhereInput = {
      businessId,
      ...statusWhere(status),
      ...(search
        ? {
            OR: [
              { canonicalName: { contains: search, mode: "insensitive" } },
              { itemCode: { startsWith: search.replace(/\s+/g, "") } },
            ],
          }
        : {}),
    };
    const chipWhere = buildPrismaFilterWhere(filters, ITEM_FILTER_COLUMNS) as Prisma.ItemWhereInput;
    const where: Prisma.ItemWhereInput =
      Object.keys(chipWhere).length > 0 ? { AND: [baseWhere, chipWhere] } : baseWhere;

    return this.prisma.item.findMany({ where, ...itemArgs });
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

  findByCanonicalName(businessId: string, canonicalName: string): Promise<{ id: string } | null> {
    return this.prisma.item.findUnique({
      where: { businessId_canonicalName: { businessId, canonicalName } },
      select: { id: true },
    });
  }

  async renameItem(id: string, canonicalName: string): Promise<void> {
    // Clears the embedding (rather than trying to recompute it inline) so the next classify
    // pass re-embeds under the new name lazily — same converge-on-use pattern as setEmbedding,
    // and doesn't make a rename hard-depend on Ollama being up.
    await this.prisma.$transaction([
      this.prisma.item.update({
        where: { id },
        data: { canonicalName, embedding: [], embeddedAt: null },
      }),
      this.prisma.$executeRaw`UPDATE items SET "embeddingVector" = NULL WHERE id = ${id}`,
    ]);
  }

  async updateCategory(
    id: string,
    categoryId: string | null,
    confirmed: boolean,
    aiConfidence: number | null,
    needsReview: boolean,
  ): Promise<void> {
    await this.prisma.item.update({
      where: { id },
      data: { categoryId, categoryConfirmed: confirmed, aiConfidence, needsReview },
    });
    await this.ensureItemCode(id);
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
    const vectorLiteral = `[${embedding.join(",")}]`;
    // One transaction: loadClassifyContext's `pending` filter keys off `embeddedAt`, so a partial
    // write (embeddedAt set, embeddingVector still NULL) would permanently hide the row from ANN
    // search and from the self-healing re-embed pass alike.
    await this.prisma.$transaction([
      this.prisma.item.update({ where: { id }, data: { embedding, embeddedAt: new Date() } }),
      this.prisma
        .$executeRaw`UPDATE items SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`,
    ]);
  }

  findConfirmedForMatch(businessId: string): Promise<ConfirmedMatchRow[]> {
    return this.prisma.item.findMany({
      where: { businessId, categoryConfirmed: true, categoryId: { not: null } },
      select: { id: true, categoryId: true, canonicalName: true, unit: true, embedding: true, embeddedAt: true },
    }) as Promise<ConfirmedMatchRow[]>;
  }

  findNearestConfirmedMatch(
    businessId: string,
    excludeItemId: string,
    queryVector: number[],
    limit: number,
  ): Promise<NearestConfirmedMatch[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "categoryId", "canonicalName", unit,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM items
      WHERE "businessId" = ${businessId} AND "categoryConfirmed" = true AND "categoryId" IS NOT NULL
        AND id != ${excludeItemId} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
  findNearestConfirmedHsn(businessId: string, queryVector: number[], limit: number): Promise<NearestConfirmedHsn[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT "canonicalName", "hsnCode", "gstRate",
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM items
      WHERE "businessId" = ${businessId} AND "hsnCodeConfirmed" = true AND "hsnCode" IS NOT NULL
        AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }

  findConfirmedHsnByFamily(businessId: string, familyKey: string): Promise<ConfirmedHsnNeighbour[]> {
    if (!familyKey) return Promise.resolve([]);
    return this.prisma.item.findMany({
      where: { businessId, familyKey, hsnCodeConfirmed: true, hsnCode: { not: null } },
      select: { canonicalName: true, hsnCode: true, gstRate: true },
      orderBy: { updatedAt: "desc" },
    }) as Promise<ConfirmedHsnNeighbour[]>;
  }

  async findConfirmedHsnUnembedded(businessId: string): Promise<{ id: string; canonicalName: string }[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; canonicalName: string }[]>`
      SELECT id, "canonicalName" FROM items
      WHERE "businessId" = ${businessId} AND "hsnCodeConfirmed" = true AND "embeddingVector" IS NULL
    `;
    return rows;
  }

  /**
   * Code = heading prefix + family serial + variant serial. The prefix follows the Item's HSN
   * (confirmed) or its category's tariff code and is refreshed whenever either becomes known; the
   * family/variant serials never change once assigned, so the code stays a stable identifier.
   * The unique (businessId, itemCode) index backstops two writers picking the same serial.
   */
  async ensureItemCode(itemId: string): Promise<string> {
    const item = await this.prisma.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        businessId: true,
        canonicalName: true,
        itemCode: true,
        hsnCode: true,
        hsnCodeConfirmed: true,
        category: { select: { code: true } },
      },
    });
    const prefix = headingPrefix(item.hsnCodeConfirmed ? item.hsnCode : item.category?.code);
    const familyKey = deriveFamilyKey(item.canonicalName);

    const existing = item.itemCode ? parseItemCode(item.itemCode) : null;
    if (existing) {
      if (prefix === "0000" || prefix === existing.prefix) return item.itemCode as string;
      const refreshed = prefix + (item.itemCode as string).slice(4);
      await this.prisma.item.update({ where: { id: itemId }, data: { itemCode: refreshed, familyKey } });
      return refreshed;
    }

    for (let attempt = 0; ; attempt += 1) {
      const { businessId } = item;
      const sibling = familyKey
        ? await this.prisma.item.findFirst({
            where: { businessId, familyKey, itemCode: { not: null } },
            select: { itemCode: true },
          })
        : null;
      const siblingParts = sibling?.itemCode ? parseItemCode(sibling.itemCode) : null;
      let family = siblingParts?.family;
      if (family === undefined) {
        const [row] = await this.prisma.$queryRaw<{ max: number | null }[]>`
          SELECT MAX(CAST(substring("itemCode" from 5 for 4) AS integer)) AS max
          FROM items WHERE "businessId" = ${businessId} AND "itemCode" IS NOT NULL
        `;
        family = (row?.max ?? 0) + 1;
      }
      const familyDigits = String(family).padStart(4, "0");
      const [variantRow] = await this.prisma.$queryRaw<{ max: number | null }[]>`
        SELECT MAX(CAST(substring("itemCode" from 9 for 3) AS integer)) AS max
        FROM items
        WHERE "businessId" = ${businessId} AND substring("itemCode" from 5 for 4) = ${familyDigits}
      `;
      const code = formatItemCode(prefix, family, (variantRow?.max ?? 0) + 1);
      try {
        await this.prisma.item.update({ where: { id: itemId }, data: { itemCode: code, familyKey } });
        return code;
      } catch (err) {
        const unique = (err as { code?: string }).code === "P2002";
        if (!unique || attempt >= 4) throw err;
      }
    }
  }
}
