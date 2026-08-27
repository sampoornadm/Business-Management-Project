import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;

const billDetailArgs = {
  include: {
    tender: { select: { id: true, title: true, tenderNumber: true, client: { select: { name: true } } } },
    createdBy: { select: creatorSelect },
    items: { orderBy: { sortOrder: "asc" } },
  },
} satisfies Prisma.BillDefaultArgs;

export type BillDetail = Prisma.BillGetPayload<typeof billDetailArgs>;

const billListArgs = {
  include: {
    tender: { select: { title: true, client: { select: { name: true } } } },
    _count: { select: { items: true } },
    items: { select: { quantity: true, rate: true } },
  },
} satisfies Prisma.BillDefaultArgs;

export type BillListItem = Prisma.BillGetPayload<typeof billListArgs>;

export interface CreateBillItemData {
  boqItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  rate: number;
  sortOrder?: number;
}

export interface CreateBillData {
  businessId: string;
  tenderId: string;
  grnNumber?: string | null;
  grnDate?: Date | null;
  createdById: string;
  items: CreateBillItemData[];
}

export interface BillFilters {
  businessId: string;
  tenderId?: string;
}

export interface IBillsRepository {
  create(data: CreateBillData): Promise<string>;
  findById(id: string, businessId: string): Promise<BillDetail | null>;
  findMany(pagination: PaginationParams, filters: BillFilters): Promise<{ items: BillListItem[]; totalItems: number }>;
}

export class BillsRepository implements IBillsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateBillData): Promise<string> {
    const billId = randomUUID();
    const billNumber = `BILL-${randomUUID().split("-")[0]!.toUpperCase()}`;
    await this.prisma.$transaction([
      this.prisma.bill.create({
        data: {
          id: billId,
          businessId: data.businessId,
          tenderId: data.tenderId,
          billNumber,
          grnNumber: data.grnNumber ?? null,
          grnDate: data.grnDate ?? null,
          createdById: data.createdById,
        },
      }),
      this.prisma.billItem.createMany({
        data: data.items.map((item, index) => ({
          id: randomUUID(),
          billId,
          boqItemId: item.boqItemId ?? null,
          description: item.description,
          unit: item.unit ?? null,
          quantity: item.quantity,
          rate: item.rate,
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return billId;
  }

  findById(id: string, businessId: string): Promise<BillDetail | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key we're filtering by
    // here — businessId must also match, and there's no compound (id, businessId) unique
    // constraint on Bill. Same reasoning as RfqRepository/ProjectsRepository's own findById.
    return this.prisma.bill.findFirst({ where: { id, businessId }, ...billDetailArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: BillFilters,
  ): Promise<{ items: BillListItem[]; totalItems: number }> {
    const where: Prisma.BillWhereInput = { businessId: filters.businessId, tenderId: filters.tenderId };
    const [items, totalItems] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        ...billListArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.bill.count({ where }),
    ]);
    return { items, totalItems };
  }
}
