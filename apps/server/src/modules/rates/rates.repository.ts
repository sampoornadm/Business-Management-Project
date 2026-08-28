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
  findEmbedded(businessId: string): Promise<HistoricalRateVector[]>;
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
    await this.prisma.historicalRate.update({
      where: { id },
      data: { embedding, embeddedAt: new Date() },
    });
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$executeRaw`UPDATE historical_rates SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
  }

  findEmbedded(businessId: string): Promise<HistoricalRateVector[]> {
    return this.prisma.historicalRate.findMany({
      where: { businessId, embeddedAt: { not: null } },
      select: { id: true, itemName: true, unit: true, rate: true, category: true, embedding: true },
    });
  }
}
