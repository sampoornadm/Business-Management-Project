import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { ChargeLoadUpdate } from "./boq-pricing.js";

const creatorSummarySelect = { id: true, firstName: true, lastName: true } as const;

const boqWithCreatorArgs = {
  include: { createdBy: { select: creatorSummarySelect } },
} satisfies Prisma.BoqDefaultArgs;

export type BoqWithCreator = Prisma.BoqGetPayload<typeof boqWithCreatorArgs>;

const boqItemWithBreakdownArgs = {
  include: {
    rateBreakdown: true,
    baseRateQuote: {
      select: {
        id: true,
        make: true,
        model: true,
        quotedAt: true,
        technicalDeviation: true,
        vendor: { select: { id: true, name: true } },
        rfqItem: { select: { rfqId: true } },
      },
    },
  },
} satisfies Prisma.BoqItemDefaultArgs;

export type BoqItemWithBreakdown = Prisma.BoqItemGetPayload<typeof boqItemWithBreakdownArgs>;

const tenderChargeArgs = {
  include: { vendor: { select: { id: true, name: true } } },
} satisfies Prisma.TenderChargeDefaultArgs;

export type TenderChargeWithVendor = Prisma.TenderChargeGetPayload<typeof tenderChargeArgs>;

export interface TenderChargeRow {
  description: string;
  amount: number;
  addToRates: boolean;
  vendorId: string | null;
  sourceRfqId: string | null;
}

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
  gstRate?: number;
  hsnCode?: string | null;
  hsnCodeConfirmed?: boolean;
  unitWeightKg?: number | null;
  remarks?: string | null;
  sortOrder?: number;
  markupPercent?: number | null;
  chargeLoad?: number | null;
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
  gstRate?: number;
  remarks: string | null;
  sortOrder: number;
}

export interface BulkRateUpdate {
  id: string;
  rate: number | null;
  amount: number | null;
  markupPercent: number | null;
}

export interface SetBaseRateData {
  baseRate: number;
  baseRateQuoteId: string;
  markupPercent: number;
  rate: number;
  amount: number | null;
  chargeLoad: null;
}

export interface UpdateBoqItemEnrichmentData {
  normalizedName: string | null;
  aiCategory: string | null;
  aiSubcategory: string | null;
  aiConfidence: number | null;
  suggestedRate: number | null;
  aiSource: string | null;
  aiRateSourceId: string | null;
  aiEnrichedAt: Date;
  suggestedHsnCode: string | null;
  suggestedHsnSource: string | null;
  suggestedGstRate: number | null;
  // Omitted (not present at all, not set to undefined/null) when hsnCode is already
  // human-confirmed — Prisma's update() skips any key that's absent from `data`, so leaving
  // these out is what makes the "never touch a confirmed value" guarantee actually hold.
  hsnCode?: string;
  gstRate?: number;
}

export interface ConfirmRateSourceData {
  rate: number;
  amount: number | null;
  rateSourceId: string | null;
  confidence: number | null;
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
  setBaseRate(id: string, data: SetBaseRateData): Promise<void>;
  updateItemEnrichment(id: string, data: UpdateBoqItemEnrichmentData): Promise<void>;
  confirmRateSource(id: string, data: ConfirmRateSourceData): Promise<void>;
  rejectRateSource(id: string): Promise<void>;
  upsertRateBreakdown(itemId: string, data: UpsertRateBreakdownData): Promise<void>;
  sumAmountByBoqId(boqId: string): Promise<number>;
  applyChargeLoads(updates: ChargeLoadUpdate[]): Promise<void>;
  findTenderCharges(tenderId: string): Promise<TenderChargeWithVendor[]>;
  findTenderChargeById(id: string, businessId: string): Promise<TenderChargeWithVendor | null>;
  createTenderCharge(tenderId: string, row: TenderChargeRow): Promise<void>;
  updateTenderCharge(id: string, data: Partial<Omit<TenderChargeRow, "sourceRfqId">>): Promise<void>;
  deleteTenderCharge(id: string): Promise<void>;
  /** Replaces the charges a given RFQ's "Finalize rates" copied earlier; hand-added rows stay. */
  replaceRfqTenderCharges(tenderId: string, rfqId: string, rows: TenderChargeRow[]): Promise<void>;
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
          data: { rate: update.rate, amount: update.amount, markupPercent: update.markupPercent, chargeLoad: null },
        }),
      ),
    );
  }

  async setBaseRate(id: string, data: SetBaseRateData): Promise<void> {
    await this.prisma.boqItem.update({ where: { id }, data });
  }

  async updateItemEnrichment(id: string, data: UpdateBoqItemEnrichmentData): Promise<void> {
    await this.prisma.boqItem.update({ where: { id }, data });
  }

  async confirmRateSource(id: string, data: ConfirmRateSourceData): Promise<void> {
    await this.prisma.boqItem.update({
      where: { id },
      data: {
        rate: data.rate,
        amount: data.amount,
        chargeLoad: null,
        suggestedRate: data.rate,
        aiSource: "historical",
        aiRateSourceId: data.rateSourceId,
        aiConfidence: data.confidence,
        rateSourceConfirmed: true,
      },
    });
  }

  async rejectRateSource(id: string): Promise<void> {
    await this.prisma.boqItem.update({
      where: { id },
      data: {
        suggestedRate: null,
        aiSource: null,
        aiRateSourceId: null,
        aiConfidence: null,
        rateSourceConfirmed: false,
      },
    });
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

  async applyChargeLoads(updates: ChargeLoadUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    await this.prisma.$transaction(
      updates.map(({ id, ...data }) => this.prisma.boqItem.update({ where: { id }, data })),
    );
  }

  findTenderCharges(tenderId: string): Promise<TenderChargeWithVendor[]> {
    // tenderId always comes from an already business-scoped tender/BOQ lookup.
    return this.prisma.tenderCharge.findMany({ where: { tenderId }, orderBy: { createdAt: "asc" }, ...tenderChargeArgs });
  }

  findTenderChargeById(id: string, businessId: string): Promise<TenderChargeWithVendor | null> {
    return this.prisma.tenderCharge.findFirst({ where: { id, tender: { businessId } }, ...tenderChargeArgs });
  }

  async createTenderCharge(tenderId: string, row: TenderChargeRow): Promise<void> {
    await this.prisma.tenderCharge.create({ data: { tenderId, ...row } });
  }

  async updateTenderCharge(id: string, data: Partial<Omit<TenderChargeRow, "sourceRfqId">>): Promise<void> {
    await this.prisma.tenderCharge.update({ where: { id }, data });
  }

  async deleteTenderCharge(id: string): Promise<void> {
    await this.prisma.tenderCharge.delete({ where: { id } });
  }

  async replaceRfqTenderCharges(tenderId: string, rfqId: string, rows: TenderChargeRow[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tenderCharge.deleteMany({ where: { tenderId, sourceRfqId: rfqId } }),
      this.prisma.tenderCharge.createMany({ data: rows.map((row) => ({ tenderId, ...row })) }),
    ]);
  }
}
