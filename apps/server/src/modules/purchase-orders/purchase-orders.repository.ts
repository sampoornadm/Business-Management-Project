import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, PurchaseOrderStatus } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;
const vendorSummarySelect = { id: true, name: true } as const;

const poDetailArgs = {
  include: {
    vendor: { select: vendorSummarySelect },
    createdBy: { select: creatorSelect },
    items: { orderBy: { sortOrder: "asc" } },
    goodsReceipts: {
      include: { receivedBy: { select: creatorSelect }, items: true },
      orderBy: { receivedDate: "desc" },
    },
    vendorRating: true,
  },
} satisfies Prisma.PurchaseOrderDefaultArgs;

export type PurchaseOrderDetail = Prisma.PurchaseOrderGetPayload<typeof poDetailArgs>;

const poListArgs = {
  include: { vendor: { select: vendorSummarySelect }, items: { select: { amount: true } } },
} satisfies Prisma.PurchaseOrderDefaultArgs;

export type PurchaseOrderListItem = Prisma.PurchaseOrderGetPayload<typeof poListArgs>;

export interface CreatePurchaseOrderItemData {
  description: string;
  unit?: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder?: number;
}

export interface CreatePurchaseOrderData {
  vendorId: string;
  tenderId?: string | null;
  sourceRfqId?: string | null;
  expectedDeliveryDate?: Date | null;
  notes?: string | null;
  createdById: string;
  items: CreatePurchaseOrderItemData[];
}

export interface PurchaseOrderFilters {
  status?: PurchaseOrderStatus;
  vendorId?: string;
  tenderId?: string;
}

export interface CreateGoodsReceiptItemData {
  purchaseOrderItemId: string;
  quantityReceived: number;
  remarks?: string | null;
}

export interface CreateGoodsReceiptData {
  purchaseOrderId: string;
  receivedById: string;
  receivedDate: Date;
  remarks?: string | null;
  items: CreateGoodsReceiptItemData[];
}

export interface IPurchaseOrdersRepository {
  create(data: CreatePurchaseOrderData): Promise<string>;
  findById(id: string): Promise<PurchaseOrderDetail | null>;
  findMany(
    pagination: PaginationParams,
    filters: PurchaseOrderFilters,
  ): Promise<{ items: PurchaseOrderListItem[]; totalItems: number }>;
  updateStatus(id: string, status: PurchaseOrderStatus): Promise<void>;
  createGoodsReceipt(data: CreateGoodsReceiptData): Promise<string>;
  upsertVendorRating(
    purchaseOrderId: string,
    vendorId: string,
    ratedById: string,
    rating: number,
    remarks?: string | null,
  ): Promise<void>;
}

export class PurchaseOrdersRepository implements IPurchaseOrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreatePurchaseOrderData): Promise<string> {
    const poId = randomUUID();
    const poNumber = `PO-${randomUUID().split("-")[0]!.toUpperCase()}`;
    await this.prisma.$transaction([
      this.prisma.purchaseOrder.create({
        data: {
          id: poId,
          poNumber,
          vendorId: data.vendorId,
          tenderId: data.tenderId ?? null,
          sourceRfqId: data.sourceRfqId ?? null,
          expectedDeliveryDate: data.expectedDeliveryDate ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById,
          status: "DRAFT",
        },
      }),
      this.prisma.purchaseOrderItem.createMany({
        data: data.items.map((item, index) => ({
          id: randomUUID(),
          purchaseOrderId: poId,
          description: item.description,
          unit: item.unit ?? null,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return poId;
  }

  findById(id: string): Promise<PurchaseOrderDetail | null> {
    return this.prisma.purchaseOrder.findUnique({ where: { id }, ...poDetailArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: PurchaseOrderFilters,
  ): Promise<{ items: PurchaseOrderListItem[]; totalItems: number }> {
    const where: Prisma.PurchaseOrderWhereInput = {
      status: filters.status,
      vendorId: filters.vendorId,
      tenderId: filters.tenderId,
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        ...poListArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { items, totalItems };
  }

  async updateStatus(id: string, status: PurchaseOrderStatus): Promise<void> {
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status } });
  }

  async createGoodsReceipt(data: CreateGoodsReceiptData): Promise<string> {
    const grnId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.goodsReceipt.create({
        data: {
          id: grnId,
          purchaseOrderId: data.purchaseOrderId,
          receivedById: data.receivedById,
          receivedDate: data.receivedDate,
          remarks: data.remarks ?? null,
        },
      }),
      this.prisma.goodsReceiptItem.createMany({
        data: data.items.map((item) => ({
          id: randomUUID(),
          goodsReceiptId: grnId,
          purchaseOrderItemId: item.purchaseOrderItemId,
          quantityReceived: item.quantityReceived,
          remarks: item.remarks ?? null,
        })),
      }),
      ...data.items.map((item) =>
        this.prisma.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: { receivedQuantity: { increment: item.quantityReceived } },
        }),
      ),
    ]);
    return grnId;
  }

  async upsertVendorRating(
    purchaseOrderId: string,
    vendorId: string,
    ratedById: string,
    rating: number,
    remarks?: string | null,
  ): Promise<void> {
    await this.prisma.vendorRating.upsert({
      where: { purchaseOrderId },
      create: { id: randomUUID(), purchaseOrderId, vendorId, ratedById, rating, remarks: remarks ?? null },
      update: { rating, remarks: remarks ?? null },
    });
  }
}
