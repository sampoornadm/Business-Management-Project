import { randomUUID } from "node:crypto";

import type { BoqStatus, Prisma, PrismaClient } from "@bmp/database";

const creatorSummarySelect = { id: true, firstName: true, lastName: true } as const;

const boqWithCreatorArgs = {
  include: { createdBy: { select: creatorSummarySelect } },
} satisfies Prisma.BoqDefaultArgs;

export type BoqWithCreator = Prisma.BoqGetPayload<typeof boqWithCreatorArgs>;

const boqItemWithBreakdownArgs = {
  include: { rateBreakdown: true },
} satisfies Prisma.BoqItemDefaultArgs;

export type BoqItemWithBreakdown = Prisma.BoqItemGetPayload<typeof boqItemWithBreakdownArgs>;

export interface CreateBoqItemRow {
  id: string;
  parentId: string | null;
  itemCode: string | null;
  description: string;
  category: string | null;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  remarks: string | null;
  sortOrder: number;
}

export interface CreateBoqData {
  id: string;
  tenderId: string;
  createdById: string;
  sourceAttachmentId: string | null;
  groupId: string;
  version: number;
  items: CreateBoqItemRow[];
}

export interface UpdateBoqItemData {
  itemCode?: string | null;
  description?: string;
  category?: string | null;
  unit?: string | null;
  quantity?: number | null;
  rate?: number | null;
  amount?: number | null;
  remarks?: string | null;
  sortOrder?: number;
}

export interface BulkRateUpdate {
  id: string;
  rate: number | null;
  amount: number | null;
}

export interface UpsertRateBreakdownData {
  materialCost: number;
  laborCost: number;
  machineryCost: number;
  transportCost: number;
  overheadPercent: number;
  profitPercent: number;
  taxPercent: number;
  computedRate: number;
}

export interface IBoqRepository {
  createBoq(data: CreateBoqData): Promise<void>;
  findBoqById(id: string): Promise<BoqWithCreator | null>;
  findCurrentBoq(tenderId: string): Promise<BoqWithCreator | null>;
  findVersions(groupId: string): Promise<BoqWithCreator[]>;
  findItemsByBoqId(boqId: string): Promise<BoqItemWithBreakdown[]>;
  findItemById(id: string): Promise<BoqItemWithBreakdown | null>;
  findItemsByIds(ids: string[]): Promise<BoqItemWithBreakdown[]>;
  updateItem(id: string, data: UpdateBoqItemData): Promise<void>;
  bulkUpdateRates(updates: BulkRateUpdate[]): Promise<void>;
  upsertRateBreakdown(itemId: string, data: UpsertRateBreakdownData): Promise<void>;
  sumAmountByBoqId(boqId: string): Promise<number>;
  finalize(boqId: string): Promise<void>;
}

export class BoqRepository implements IBoqRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createBoq(data: CreateBoqData): Promise<void> {
    await this.prisma.$transaction([
      // Only one Boq is ever "current" per tender, even across independent
      // groupId lineages (e.g. a fresh re-upload that isn't a versioned edit).
      this.prisma.boq.updateMany({ where: { tenderId: data.tenderId }, data: { isCurrent: false } }),
      this.prisma.boq.create({
        data: {
          id: data.id,
          tenderId: data.tenderId,
          sourceAttachmentId: data.sourceAttachmentId,
          groupId: data.groupId,
          version: data.version,
          isCurrent: true,
          status: "DRAFT" as BoqStatus,
          createdById: data.createdById,
        },
      }),
      this.prisma.boqItem.createMany({
        data: data.items.map((item) => ({ ...item, boqId: data.id })),
      }),
    ]);
  }

  findBoqById(id: string): Promise<BoqWithCreator | null> {
    return this.prisma.boq.findUnique({ where: { id }, ...boqWithCreatorArgs });
  }

  findCurrentBoq(tenderId: string): Promise<BoqWithCreator | null> {
    return this.prisma.boq.findFirst({ where: { tenderId, isCurrent: true }, ...boqWithCreatorArgs });
  }

  findVersions(groupId: string): Promise<BoqWithCreator[]> {
    return this.prisma.boq.findMany({
      where: { groupId },
      orderBy: { version: "desc" },
      ...boqWithCreatorArgs,
    });
  }

  findItemsByBoqId(boqId: string): Promise<BoqItemWithBreakdown[]> {
    return this.prisma.boqItem.findMany({
      where: { boqId },
      orderBy: { sortOrder: "asc" },
      ...boqItemWithBreakdownArgs,
    });
  }

  findItemById(id: string): Promise<BoqItemWithBreakdown | null> {
    return this.prisma.boqItem.findUnique({ where: { id }, ...boqItemWithBreakdownArgs });
  }

  findItemsByIds(ids: string[]): Promise<BoqItemWithBreakdown[]> {
    return this.prisma.boqItem.findMany({ where: { id: { in: ids } }, ...boqItemWithBreakdownArgs });
  }

  async updateItem(id: string, data: UpdateBoqItemData): Promise<void> {
    await this.prisma.boqItem.update({ where: { id }, data });
  }

  async bulkUpdateRates(updates: BulkRateUpdate[]): Promise<void> {
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.boqItem.update({
          where: { id: update.id },
          data: { rate: update.rate, amount: update.amount },
        }),
      ),
    );
  }

  async upsertRateBreakdown(itemId: string, data: UpsertRateBreakdownData): Promise<void> {
    await this.prisma.boqItemRateBreakdown.upsert({
      where: { boqItemId: itemId },
      create: { id: randomUUID(), boqItemId: itemId, ...data },
      update: data,
    });
  }

  async sumAmountByBoqId(boqId: string): Promise<number> {
    const result = await this.prisma.boqItem.aggregate({
      where: { boqId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async finalize(boqId: string): Promise<void> {
    await this.prisma.boq.update({ where: { id: boqId }, data: { status: "FINALIZED" } });
  }
}
