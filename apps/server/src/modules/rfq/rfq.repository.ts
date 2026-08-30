import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, RfqStatus, RfqVendorStatus } from "@bmp/database";
import type { ItemPriceSortField } from "@bmp/types";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;
const vendorSummarySelect = { id: true, name: true } as const;

const rfqDetailArgs = {
  include: {
    createdBy: { select: creatorSelect },
    items: {
      include: { quotes: { include: { vendor: { select: vendorSummarySelect } } } },
      orderBy: { sortOrder: "asc" },
    },
    vendorInvites: {
      include: { vendor: { select: vendorSummarySelect } },
      orderBy: { createdAt: "asc" },
    },
  },
} satisfies Prisma.RfqDefaultArgs;

export type RfqDetail = Prisma.RfqGetPayload<typeof rfqDetailArgs>;
export type RfqItemDetail = RfqDetail["items"][number];

const rfqListArgs = {
  include: { _count: { select: { items: true, vendorInvites: true } } },
} satisfies Prisma.RfqDefaultArgs;

export type RfqListItem = Prisma.RfqGetPayload<typeof rfqListArgs>;

const itemPriceArgs = {
  select: {
    id: true,
    rate: true,
    make: true,
    model: true,
    quotedAt: true,
    remarks: true,
    vendor: { select: { id: true, name: true } },
    rfqItem: {
      select: {
        description: true,
        unit: true,
        quantity: true,
        boqItemId: true,
        rfq: {
          select: { id: true, title: true, tender: { select: { id: true, title: true } } },
        },
      },
    },
  },
} satisfies Prisma.RfqQuoteDefaultArgs;

export type ItemPriceRow = Prisma.RfqQuoteGetPayload<typeof itemPriceArgs>;

export interface ItemPriceFilters {
  businessId: string;
  // Matches item description, make, or model (case-insensitive).
  search?: string;
  vendorId?: string;
  // Restrict to one resolved Item — used by the item-detail page.
  itemId?: string;
  sortBy?: ItemPriceSortField;
  sortDir?: "asc" | "desc";
}

function itemPriceOrderBy(
  sortBy: ItemPriceSortField | undefined,
  dir: "asc" | "desc",
): Prisma.RfqQuoteOrderByWithRelationInput {
  switch (sortBy) {
    case "description":
      return { rfqItem: { description: dir } };
    case "unit":
      return { rfqItem: { unit: dir } };
    case "quantity":
      return { rfqItem: { quantity: dir } };
    case "vendorName":
      return { vendor: { name: dir } };
    case "rate":
      return { rate: dir };
    case "make":
      return { make: dir };
    case "rfqTitle":
      return { rfqItem: { rfq: { title: dir } } };
    case "quotedAt":
    default:
      // Default view: most recent quotes first.
      return { quotedAt: dir };
  }
}

export interface CreateRfqItemData {
  boqItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  instructions?: string | null;
  sortOrder?: number;
}

export interface CreateRfqData {
  title: string;
  tenderId?: string | null;
  businessId: string;
  dueDate?: Date | null;
  instructions?: string | null;
  createdById: string;
  items: CreateRfqItemData[];
}

export type UpdateRfqData = Partial<Pick<CreateRfqData, "title" | "dueDate" | "instructions">>;

export interface UpsertQuoteData {
  // Null is a regret — the absence of a price, never 0. See RfqQuote.rate in schema.prisma.
  rate: number | null;
  regretted: boolean;
  make?: string;
  model?: string;
  quotedAt?: Date;
  remarks?: string | null;
}

export interface RfqFilters {
  businessId: string;
  status?: RfqStatus;
  tenderId?: string;
}

export interface IRfqRepository {
  create(data: CreateRfqData): Promise<string>;
  findById(id: string, businessId: string): Promise<RfqDetail | null>;
  findMany(
    pagination: PaginationParams,
    filters: RfqFilters,
  ): Promise<{ items: RfqListItem[]; totalItems: number }>;
  update(id: string, data: UpdateRfqData): Promise<void>;
  updateStatus(id: string, status: RfqStatus): Promise<void>;
  selectQuote(rfqItemId: string, quoteId: string): Promise<void>;
  reopen(id: string, status: RfqStatus): Promise<void>;
  findVendorInvite(rfqId: string, vendorId: string): Promise<{ id: string } | null>;
  addVendorInvite(rfqId: string, vendorId: string): Promise<void>;
  updateVendorInviteStatus(rfqId: string, vendorId: string, status: RfqVendorStatus): Promise<void>;
  removeVendorInvite(rfqId: string, vendorId: string): Promise<void>;
  findItemById(itemId: string): Promise<{ id: string; rfqId: string; quantity: number } | null>;
  upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData): Promise<void>;
  listItemPrices(
    pagination: PaginationParams,
    filters: ItemPriceFilters,
  ): Promise<{ items: ItemPriceRow[]; totalItems: number }>;
  findBoqItemCategories(ids: string[]): Promise<{ id: string; category: string | null }[]>;
}

export class RfqRepository implements IRfqRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateRfqData): Promise<string> {
    const rfqId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.rfq.create({
        data: {
          id: rfqId,
          title: data.title,
          tenderId: data.tenderId ?? null,
          businessId: data.businessId,
          dueDate: data.dueDate ?? null,
          instructions: data.instructions ?? null,
          createdById: data.createdById,
        },
      }),
      this.prisma.rfqItem.createMany({
        data: data.items.map((item, index) => ({
          id: randomUUID(),
          rfqId,
          boqItemId: item.boqItemId ?? null,
          description: item.description,
          unit: item.unit ?? null,
          quantity: item.quantity,
          instructions: item.instructions ?? null,
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return rfqId;
  }

  findById(id: string, businessId: string): Promise<RfqDetail | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key
    // we're filtering by here — businessId must also match, and there's no
    // compound (id, businessId) unique constraint on Rfq.
    return this.prisma.rfq.findFirst({ where: { id, businessId }, ...rfqDetailArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: RfqFilters,
  ): Promise<{ items: RfqListItem[]; totalItems: number }> {
    const where: Prisma.RfqWhereInput = {
      businessId: filters.businessId,
      status: filters.status,
      tenderId: filters.tenderId,
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.rfq.findMany({
        where,
        ...rfqListArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.rfq.count({ where }),
    ]);

    return { items, totalItems };
  }

  async update(id: string, data: UpdateRfqData): Promise<void> {
    await this.prisma.rfq.update({ where: { id }, data });
  }

  async updateStatus(id: string, status: RfqStatus): Promise<void> {
    await this.prisma.rfq.update({ where: { id }, data: { status } });
  }

  async selectQuote(rfqItemId: string, quoteId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.rfqQuote.updateMany({
        where: { rfqItemId, isSelected: true },
        data: { isSelected: false },
      }),
      this.prisma.rfqQuote.update({
        where: { id: quoteId },
        data: { isSelected: true },
      }),
    ]);
  }

  async reopen(id: string, status: RfqStatus): Promise<void> {
    await this.prisma.rfq.update({ where: { id }, data: { status, awardedVendorId: null } });
  }

  findVendorInvite(rfqId: string, vendorId: string): Promise<{ id: string } | null> {
    return this.prisma.rfqVendor.findUnique({
      where: { rfqId_vendorId: { rfqId, vendorId } },
      select: { id: true },
    });
  }

  async addVendorInvite(rfqId: string, vendorId: string): Promise<void> {
    await this.prisma.rfqVendor.create({ data: { id: randomUUID(), rfqId, vendorId } });
  }

  async updateVendorInviteStatus(
    rfqId: string,
    vendorId: string,
    status: RfqVendorStatus,
  ): Promise<void> {
    await this.prisma.rfqVendor.update({
      where: { rfqId_vendorId: { rfqId, vendorId } },
      data: { status },
    });
  }

  async removeVendorInvite(rfqId: string, vendorId: string): Promise<void> {
    await this.prisma.rfqVendor.delete({ where: { rfqId_vendorId: { rfqId, vendorId } } });
  }

  findItemById(itemId: string): Promise<{ id: string; rfqId: string; quantity: number } | null> {
    return this.prisma.rfqItem.findUnique({
      where: { id: itemId },
      select: { id: true, rfqId: true, quantity: true },
    });
  }

  async upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData): Promise<void> {
    const payload = {
      rate: data.rate,
      regretted: data.regretted,
      remarks: data.remarks ?? null,
      // Omit rather than pass undefined so the column defaults apply on create.
      ...(data.make !== undefined ? { make: data.make } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.quotedAt !== undefined ? { quotedAt: data.quotedAt } : {}),
    };
    await this.prisma.rfqQuote.upsert({
      where: { rfqItemId_vendorId: { rfqItemId, vendorId } },
      create: { id: randomUUID(), rfqItemId, vendorId, ...payload },
      update: payload,
    });
  }

  async listItemPrices(
    pagination: PaginationParams,
    filters: ItemPriceFilters,
  ): Promise<{ items: ItemPriceRow[]; totalItems: number }> {
    const where: Prisma.RfqQuoteWhereInput = {
      // A price-history view: skip regrets/no-price rows so every row carries a real rate.
      regretted: false,
      rate: { not: null },
      vendorId: filters.vendorId,
      rfqItem: { itemId: filters.itemId, rfq: { businessId: filters.businessId } },
      ...(filters.search
        ? {
            OR: [
              { rfqItem: { description: { contains: filters.search, mode: "insensitive" } } },
              { make: { contains: filters.search, mode: "insensitive" } },
              { model: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.rfqQuote.findMany({
        where,
        ...itemPriceArgs,
        orderBy: itemPriceOrderBy(filters.sortBy, filters.sortDir ?? "desc"),
        ...toSkipTake(pagination),
      }),
      this.prisma.rfqQuote.count({ where }),
    ]);

    return { items, totalItems };
  }

  // BoqItem is an unenforced ref from RfqItem.boqItemId (no relation), so category
  // is resolved with a separate keyed lookup rather than an include.
  findBoqItemCategories(ids: string[]): Promise<{ id: string; category: string | null }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.boqItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, category: true },
    });
  }
}
