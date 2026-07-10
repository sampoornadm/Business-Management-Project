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
  businessId: string;
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

export interface CreateBoqItemData {
  id: string;
  boqId: string;
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
  findBoqById(id: string, businessId: string): Promise<BoqWithCreator | null>;
  findCurrentBoq(tenderId: string, businessId: string): Promise<BoqWithCreator | null>;
  findVersions(groupId: string, businessId: string): Promise<BoqWithCreator[]>;
  findItemsByBoqId(boqId: string): Promise<BoqItemWithBreakdown[]>;
  findItemById(id: string, businessId: string): Promise<BoqItemWithBreakdown | null>;
  findItemsByIds(ids: string[], businessId: string): Promise<BoqItemWithBreakdown[]>;
  updateItem(id: string, data: UpdateBoqItemData): Promise<void>;
  createItem(data: CreateBoqItemData): Promise<BoqItemWithBreakdown>;
  deleteItem(id: string): Promise<void>;
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
      // Scoped by businessId too, even though tenderId alone would already
      // narrow this correctly — keeps the write symmetric with every read below.
      this.prisma.boq.updateMany({
        where: { tenderId: data.tenderId, businessId: data.businessId },
        data: { isCurrent: false },
      }),
      this.prisma.boq.create({
        data: {
          id: data.id,
          tenderId: data.tenderId,
          businessId: data.businessId,
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

  findBoqById(id: string, businessId: string): Promise<BoqWithCreator | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key we're
    // filtering by here — businessId must also match, and there's no
    // compound (id, businessId) unique constraint on Boq.
    return this.prisma.boq.findFirst({ where: { id, businessId }, ...boqWithCreatorArgs });
  }

  findCurrentBoq(tenderId: string, businessId: string): Promise<BoqWithCreator | null> {
    return this.prisma.boq.findFirst({
      where: { tenderId, businessId, isCurrent: true },
      ...boqWithCreatorArgs,
    });
  }

  findVersions(groupId: string, businessId: string): Promise<BoqWithCreator[]> {
    return this.prisma.boq.findMany({
      where: { groupId, businessId },
      orderBy: { version: "desc" },
      ...boqWithCreatorArgs,
    });
  }

  findItemsByBoqId(boqId: string): Promise<BoqItemWithBreakdown[]> {
    // boqId is always sourced from an already business-scoped Boq lookup
    // (findBoqById/findCurrentBoq) immediately before this is called, same
    // convention as findMaterialUsages/findLaborEntries/findBills in
    // projects.repository.ts for children of an already-validated parent.
    return this.prisma.boqItem.findMany({
      where: { boqId },
      orderBy: { sortOrder: "asc" },
      ...boqItemWithBreakdownArgs,
    });
  }

  findItemById(id: string, businessId: string): Promise<BoqItemWithBreakdown | null> {
    // BoqItem has no businessId column of its own — scope through the parent
    // Boq relation instead, same idea as the direct (id, businessId) filters
    // above but joined one level down.
    return this.prisma.boqItem.findFirst({
      where: { id, boq: { businessId } },
      ...boqItemWithBreakdownArgs,
    });
  }

  findItemsByIds(ids: string[], businessId: string): Promise<BoqItemWithBreakdown[]> {
    return this.prisma.boqItem.findMany({
      where: { id: { in: ids }, boq: { businessId } },
      ...boqItemWithBreakdownArgs,
    });
  }

  async updateItem(id: string, data: UpdateBoqItemData): Promise<void> {
    await this.prisma.boqItem.update({ where: { id }, data });
  }

  createItem(data: CreateBoqItemData): Promise<BoqItemWithBreakdown> {
    return this.prisma.boqItem.create({ data, ...boqItemWithBreakdownArgs });
  }

  async deleteItem(id: string): Promise<void> {
    await this.prisma.boqItem.delete({ where: { id } });
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
