import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, RfqStatus, RfqVendorStatus } from "@bmp/database";

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

export interface CreateRfqItemData {
  boqItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  sortOrder?: number;
}

export interface CreateRfqData {
  title: string;
  tenderId?: string | null;
  dueDate?: Date | null;
  createdById: string;
  items: CreateRfqItemData[];
}

export type UpdateRfqData = Partial<Pick<CreateRfqData, "title" | "dueDate">>;

export interface RfqFilters {
  status?: RfqStatus;
  tenderId?: string;
}

export interface IRfqRepository {
  create(data: CreateRfqData): Promise<string>;
  findById(id: string): Promise<RfqDetail | null>;
  findMany(
    pagination: PaginationParams,
    filters: RfqFilters,
  ): Promise<{ items: RfqListItem[]; totalItems: number }>;
  update(id: string, data: UpdateRfqData): Promise<void>;
  updateStatus(id: string, status: RfqStatus): Promise<void>;
  setAwardedVendor(id: string, vendorId: string): Promise<void>;
  reopen(id: string, status: RfqStatus): Promise<void>;
  findVendorInvite(rfqId: string, vendorId: string): Promise<{ id: string } | null>;
  addVendorInvite(rfqId: string, vendorId: string): Promise<void>;
  updateVendorInviteStatus(rfqId: string, vendorId: string, status: RfqVendorStatus): Promise<void>;
  removeVendorInvite(rfqId: string, vendorId: string): Promise<void>;
  findItemById(itemId: string): Promise<{ id: string; rfqId: string; quantity: number } | null>;
  upsertQuote(rfqItemId: string, vendorId: string, rate: number, remarks?: string | null): Promise<void>;
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
          dueDate: data.dueDate ?? null,
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
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return rfqId;
  }

  findById(id: string): Promise<RfqDetail | null> {
    return this.prisma.rfq.findUnique({ where: { id }, ...rfqDetailArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: RfqFilters,
  ): Promise<{ items: RfqListItem[]; totalItems: number }> {
    const where: Prisma.RfqWhereInput = { status: filters.status, tenderId: filters.tenderId };

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

  async setAwardedVendor(id: string, vendorId: string): Promise<void> {
    await this.prisma.rfq.update({
      where: { id },
      data: { awardedVendorId: vendorId, status: "AWARDED" },
    });
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

  async upsertQuote(
    rfqItemId: string,
    vendorId: string,
    rate: number,
    remarks?: string | null,
  ): Promise<void> {
    await this.prisma.rfqQuote.upsert({
      where: { rfqItemId_vendorId: { rfqItemId, vendorId } },
      create: { id: randomUUID(), rfqItemId, vendorId, rate, remarks: remarks ?? null },
      update: { rate, remarks: remarks ?? null },
    });
  }
}
