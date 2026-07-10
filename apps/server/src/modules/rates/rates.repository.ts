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

export interface IHistoricalRatesRepository {
  findMany(filters: ListHistoricalRatesFilters): Promise<HistoricalRateWithCreator[]>;
  suggest(
    category: HistoricalRateCategory,
    itemName: string,
    limit: number,
    businessId: string,
  ): Promise<HistoricalRateWithCreator[]>;
  create(data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator>;
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
}
