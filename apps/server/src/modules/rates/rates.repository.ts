import { randomUUID } from "node:crypto";

import type { HistoricalRateCategory, Prisma, PrismaClient } from "@bmp/database";

const creatorSummarySelect = { id: true, firstName: true, lastName: true } as const;

const historicalRateArgs = {
  include: { createdBy: { select: creatorSummarySelect } },
} satisfies Prisma.HistoricalRateDefaultArgs;

export type HistoricalRateWithCreator = Prisma.HistoricalRateGetPayload<typeof historicalRateArgs>;

export interface CreateHistoricalRateData {
  category: HistoricalRateCategory;
  itemName: string;
  unit: string;
  rate: number;
  location?: string | null;
  effectiveDate: Date;
  sourceTenderId?: string | null;
  notes?: string | null;
  businessId: string;
  createdById: string;
}

export interface ListHistoricalRatesFilters {
  businessId: string;
  category?: HistoricalRateCategory;
  itemName?: string;
}

/** Just what the similarity search needs — deliberately not the full entity + creator join. */
export interface HistoricalRateVector {
  id: string;
  itemName: string;
  unit: string;
  rate: number;
  category: HistoricalRateCategory;
  embedding: number[];
}

/** A ranked ANN result — flat, no `embedding` column, since nothing downstream needs the vector. */
export interface HistoricalRateMatch {
  id: string;
  itemName: string;
  unit: string;
  rate: number;
  category: HistoricalRateCategory;
  similarity: number;
}

export interface RecordFromRfqQuoteData {
  businessId: string;
  itemName: string;
  unit: string;
  rate: number;
  vendorId: string;
  rfqQuoteId: string;
  sourceTenderId?: string | null;
  createdById: string;
}

export interface IHistoricalRatesRepository {
  findMany(filters: ListHistoricalRatesFilters): Promise<HistoricalRateWithCreator[]>;
  suggest(
    category: HistoricalRateCategory,
    itemName: string,
    limit: number,
    businessId: string,
  ): Promise<HistoricalRateWithCreator[]>;
  create(data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator>;
  findUnembedded(businessId: string): Promise<{ id: string; itemName: string }[]>;
  setEmbedding(id: string, embedding: number[]): Promise<void>;
  findNearest(businessId: string, queryVector: number[], limit: number): Promise<HistoricalRateMatch[]>;
  recordFromRfqQuote(data: RecordFromRfqQuoteData): Promise<void>;
}

export class HistoricalRatesRepository implements IHistoricalRatesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(filters: ListHistoricalRatesFilters): Promise<HistoricalRateWithCreator[]> {
    return this.prisma.historicalRate.findMany({
      where: {
        businessId: filters.businessId,
        category: filters.category,
        itemName: filters.itemName ? { contains: filters.itemName, mode: "insensitive" } : undefined,
      },
      orderBy: { effectiveDate: "desc" },
      ...historicalRateArgs,
    });
  }

  suggest(
    category: HistoricalRateCategory,
    itemName: string,
    limit: number,
    businessId: string,
  ): Promise<HistoricalRateWithCreator[]> {
    return this.prisma.historicalRate.findMany({
      where: { businessId, category, itemName: { contains: itemName, mode: "insensitive" } },
      orderBy: { effectiveDate: "desc" },
      take: limit,
      ...historicalRateArgs,
    });
  }

  create(data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator> {
    return this.prisma.historicalRate.create({
      data: { id: randomUUID(), ...data },
      ...historicalRateArgs,
    });
  }

  findUnembedded(businessId: string): Promise<{ id: string; itemName: string }[]> {
    return this.prisma.historicalRate.findMany({
      where: { businessId, embeddedAt: null },
      select: { id: true, itemName: true },
    });
  }

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(",")}]`;
    // One transaction: findUnembedded() keys off `embeddedAt`, so a partial write (embeddedAt set,
    // embeddingVector still NULL) would permanently hide the row from ANN search and from the
    // self-healing re-embed pass alike.
    await this.prisma.$transaction([
      this.prisma.historicalRate.update({
        where: { id },
        data: { embedding, embeddedAt: new Date() },
      }),
      this.prisma
        .$executeRaw`UPDATE historical_rates SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`,
    ]);
  }

  findNearest(
    businessId: string,
    queryVector: number[],
    limit: number,
  ): Promise<HistoricalRateMatch[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "itemName", unit, rate, category,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM historical_rates
      WHERE "businessId" = ${businessId} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }

  async recordFromRfqQuote(data: RecordFromRfqQuoteData): Promise<void> {
    // Business rule (not a DB constraint): at most one isDefault=true row per (businessId,
    // itemName). Clearing the prior default and inserting the new one must be atomic, or a
    // crash mid-way could leave either zero or two defaults for the same item.
    //
    // upsert (not create): rfqQuoteId is @unique, and "push rates to tender" is re-clickable on a
    // CLOSED RFQ indefinitely — a repeat push for a quote already recorded must update the
    // existing row, not throw P2002.
    await this.prisma.$transaction([
      this.prisma.historicalRate.updateMany({
        where: { businessId: data.businessId, itemName: data.itemName, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.historicalRate.upsert({
        where: { rfqQuoteId: data.rfqQuoteId },
        create: {
          id: randomUUID(),
          businessId: data.businessId,
          category: "MATERIAL",
          itemName: data.itemName,
          unit: data.unit,
          rate: data.rate,
          effectiveDate: new Date(),
          sourceTenderId: data.sourceTenderId ?? null,
          vendorId: data.vendorId,
          rfqQuoteId: data.rfqQuoteId,
          isDefault: true,
          createdById: data.createdById,
        },
        update: {
          itemName: data.itemName,
          unit: data.unit,
          rate: data.rate,
          effectiveDate: new Date(),
          sourceTenderId: data.sourceTenderId ?? null,
          vendorId: data.vendorId,
          isDefault: true,
        },
      }),
    ]);
  }
}
