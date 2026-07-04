import type { PrismaClient, TenderStatus } from "@bmp/database";

export interface PurchaseOrderSpendRow {
  amount: number;
  vendorId: string;
  vendorName: string;
  poCreatedAt: Date;
}

export interface ProjectBasicRow {
  id: string;
  name: string;
  status: string;
  budget: number;
  tenderId: string;
}

export interface PaymentBasicRow {
  direction: "RECEIVED" | "PAID";
  amount: number;
  paymentDate: Date;
}

export interface PurchaseOrderForOnTimeRow {
  id: string;
  vendorId: string;
  expectedDeliveryDate: Date | null;
}

export interface IReportsRepository {
  findTenderStatusCounts(): Promise<{ status: TenderStatus; count: number }[]>;
  findTenderDates(): Promise<{ createdAt: Date; submissionDate: Date }[]>;

  findPurchaseOrderItemsForSpend(from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]>;

  findActiveProjectsBasic(): Promise<ProjectBasicRow[]>;
  findPurchaseOrderTotalsByTenderIds(
    tenderIds: string[],
  ): Promise<{ tenderId: string; amount: number }[]>;
  findLaborTotalsByProjectIds(projectIds: string[]): Promise<{ projectId: string; amount: number }[]>;

  findPaymentsForSummary(from?: Date, to?: Date): Promise<PaymentBasicRow[]>;

  findVendorsBasic(): Promise<{ id: string; name: string }[]>;
  findVendorRatings(): Promise<{ vendorId: string; rating: number }[]>;
  findPurchaseOrdersForOnTimeCalc(): Promise<PurchaseOrderForOnTimeRow[]>;
  findLatestGoodsReceiptDatesByPoIds(poIds: string[]): Promise<{ purchaseOrderId: string; receivedDate: Date }[]>;
  countPurchaseOrdersByVendor(): Promise<{ vendorId: string; count: number }[]>;

  findAllInvoiceTotals(): Promise<{ totalAmount: number; invoiceDate: Date }[]>;
  sumPaymentsByEntityType(entityType: string): Promise<number>;

  findGoodsReceiptLeadTimes(): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]>;
  findBoqCreationLeadTimes(): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]>;

  searchTenders(query: string): Promise<{ id: string; tenderNumber: string; title: string }[]>;
  searchOrganizations(query: string): Promise<{ id: string; name: string }[]>;
  searchVendors(query: string): Promise<{ id: string; name: string }[]>;
  searchProjects(query: string): Promise<{ id: string; name: string }[]>;
}

const SEARCH_LIMIT = 5;

export class ReportsRepository implements IReportsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenderStatusCounts(): Promise<{ status: TenderStatus; count: number }[]> {
    const groups = await this.prisma.tender.groupBy({ by: ["status"], _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  }

  findTenderDates(): Promise<{ createdAt: Date; submissionDate: Date }[]> {
    return this.prisma.tender.findMany({ select: { createdAt: true, submissionDate: true } });
  }

  async findPurchaseOrderItemsForSpend(from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]> {
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          createdAt: from || to ? { gte: from, lte: to } : undefined,
        },
      },
      select: {
        amount: true,
        purchaseOrder: {
          select: { createdAt: true, vendor: { select: { id: true, name: true } } },
        },
      },
    });
    return items.map((item) => ({
      amount: item.amount,
      vendorId: item.purchaseOrder.vendor.id,
      vendorName: item.purchaseOrder.vendor.name,
      poCreatedAt: item.purchaseOrder.createdAt,
    }));
  }

  findActiveProjectsBasic(): Promise<ProjectBasicRow[]> {
    return this.prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "ON_HOLD"] } },
      select: { id: true, name: true, status: true, budget: true, tenderId: true },
    });
  }

  async findPurchaseOrderTotalsByTenderIds(
    tenderIds: string[],
  ): Promise<{ tenderId: string; amount: number }[]> {
    if (tenderIds.length === 0) return [];
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          tenderId: { in: tenderIds },
          status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] },
        },
      },
      select: { amount: true, purchaseOrder: { select: { tenderId: true } } },
    });
    return items.map((item) => ({ tenderId: item.purchaseOrder.tenderId!, amount: item.amount }));
  }

  async findLaborTotalsByProjectIds(
    projectIds: string[],
  ): Promise<{ projectId: string; amount: number }[]> {
    if (projectIds.length === 0) return [];
    return this.prisma.projectLaborEntry.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, amount: true },
    });
  }

  findPaymentsForSummary(from?: Date, to?: Date): Promise<PaymentBasicRow[]> {
    return this.prisma.payment.findMany({
      where: from || to ? { paymentDate: { gte: from, lte: to } } : undefined,
      select: { direction: true, amount: true, paymentDate: true },
    });
  }

  findVendorsBasic(): Promise<{ id: string; name: string }[]> {
    return this.prisma.vendor.findMany({ select: { id: true, name: true } });
  }

  findVendorRatings(): Promise<{ vendorId: string; rating: number }[]> {
    return this.prisma.vendorRating.findMany({ select: { vendorId: true, rating: true } });
  }

  findPurchaseOrdersForOnTimeCalc(): Promise<PurchaseOrderForOnTimeRow[]> {
    return this.prisma.purchaseOrder.findMany({
      where: { expectedDeliveryDate: { not: null } },
      select: { id: true, vendorId: true, expectedDeliveryDate: true },
    });
  }

  findLatestGoodsReceiptDatesByPoIds(
    poIds: string[],
  ): Promise<{ purchaseOrderId: string; receivedDate: Date }[]> {
    if (poIds.length === 0) return Promise.resolve([]);
    return this.prisma.goodsReceipt.findMany({
      where: { purchaseOrderId: { in: poIds } },
      orderBy: { receivedDate: "desc" },
      select: { purchaseOrderId: true, receivedDate: true },
    });
  }

  async countPurchaseOrdersByVendor(): Promise<{ vendorId: string; count: number }[]> {
    const groups = await this.prisma.purchaseOrder.groupBy({ by: ["vendorId"], _count: { _all: true } });
    return groups.map((g) => ({ vendorId: g.vendorId, count: g._count._all }));
  }

  findAllInvoiceTotals(): Promise<{ totalAmount: number; invoiceDate: Date }[]> {
    return this.prisma.invoice.findMany({ select: { totalAmount: true, invoiceDate: true } });
  }

  async sumPaymentsByEntityType(entityType: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { entityType },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  findGoodsReceiptLeadTimes(): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]> {
    return this.prisma.goodsReceipt
      .findMany({
        select: { receivedDate: true, purchaseOrder: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ purchaseOrderCreatedAt: r.purchaseOrder.createdAt, receivedDate: r.receivedDate })));
  }

  findBoqCreationLeadTimes(): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]> {
    return this.prisma.boq
      .findMany({
        where: { isCurrent: true },
        select: { createdAt: true, tender: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ tenderCreatedAt: r.tender.createdAt, boqCreatedAt: r.createdAt })));
  }

  searchTenders(query: string): Promise<{ id: string; tenderNumber: string; title: string }[]> {
    return this.prisma.tender.findMany({
      where: {
        OR: [
          { tenderNumber: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, tenderNumber: true, title: true },
      take: SEARCH_LIMIT,
    });
  }

  searchOrganizations(query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.organization.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }

  searchVendors(query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.vendor.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }

  searchProjects(query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.project.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }
}
