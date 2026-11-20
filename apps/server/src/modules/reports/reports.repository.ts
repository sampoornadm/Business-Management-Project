import type { PrismaClient, TenderStatus } from "@bmp/database";

export interface PurchaseOrderSpendRow {
  amount: number;
  vendorId: string;
  vendorName: string;
  poCreatedAt: Date;
}

/** Raw money totals for one project, summed in the repository; profit is derived in the service. */
export interface ProjectProfitSourceRow {
  id: string;
  name: string;
  status: string;
  clientPoValue: number;
  billed: number;
  received: number;
  vendorCost: number;
  freight: number;
  otherCosts: number;
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

export interface AttachmentMetadataRow {
  id: string;
  originalName: string;
  documentType: string | null;
  entityId: string; // the tender id (Attachment.entityType/entityId is an unenforced generic reference)
}

export interface EmbeddedAttachmentRow extends AttachmentMetadataRow {
  embedding: number[];
}

export interface IReportsRepository {
  findTenderStatusCounts(businessId: string): Promise<{ status: TenderStatus; count: number }[]>;
  findTenderDates(businessId: string): Promise<{ createdAt: Date; submissionDate: Date | null }[]>;

  findPurchaseOrderItemsForSpend(businessId: string, from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]>;

  findProjectProfitSources(businessId: string, projectId?: string): Promise<ProjectProfitSourceRow[]>;

  findPaymentsForSummary(businessId: string, from?: Date, to?: Date): Promise<PaymentBasicRow[]>;

  findVendorsBasic(): Promise<{ id: string; name: string }[]>;
  findVendorRatings(businessId: string): Promise<{ vendorId: string; rating: number }[]>;
  findPurchaseOrdersForOnTimeCalc(businessId: string): Promise<PurchaseOrderForOnTimeRow[]>;
  findLatestGoodsReceiptDatesByPoIds(businessId: string, poIds: string[]): Promise<{ purchaseOrderId: string; receivedDate: Date }[]>;
  countPurchaseOrdersByVendor(businessId: string): Promise<{ vendorId: string; count: number }[]>;

  findAllInvoiceTotals(businessId: string): Promise<{ totalAmount: number; invoiceDate: Date }[]>;
  sumPaymentsByEntityType(businessId: string, entityType: string): Promise<number>;

  findGoodsReceiptLeadTimes(businessId: string): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]>;
  findBoqCreationLeadTimes(businessId: string): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]>;

  searchTenders(businessId: string, query: string): Promise<{ id: string; tenderNumber: string; title: string }[]>;
  searchOrganizations(query: string): Promise<{ id: string; name: string }[]>;
  searchVendors(query: string): Promise<{ id: string; name: string }[]>;
  searchProjects(businessId: string, query: string): Promise<{ id: string; name: string }[]>;
  findTenderIdsForBusiness(businessId: string): Promise<{ id: string; tenderNumber: string }[]>;
  searchAttachmentsByMetadata(tenderIds: string[], query: string): Promise<AttachmentMetadataRow[]>;
  findNearestAttachments(
    tenderIds: string[],
    queryVector: number[],
    limit: number,
    threshold: number,
  ): Promise<(AttachmentMetadataRow & { similarity: number })[]>;
}

const SEARCH_LIMIT = 5;

export class ReportsRepository implements IReportsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenderStatusCounts(businessId: string): Promise<{ status: TenderStatus; count: number }[]> {
    // Budgetary quotations aren't part of the real tender pipeline — exclude them from reporting
    // the same way they're already excluded from the default tenders list view.
    const groups = await this.prisma.tender.groupBy({
      where: { businessId, kind: "TENDER" },
      by: ["status"],
      _count: { _all: true },
    });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  }

  findTenderDates(businessId: string): Promise<{ createdAt: Date; submissionDate: Date | null }[]> {
    return this.prisma.tender.findMany({
      where: { businessId, kind: "TENDER" },
      select: { createdAt: true, submissionDate: true },
    });
  }

  async findPurchaseOrderItemsForSpend(businessId: string, from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]> {
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          businessId,
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

  async findProjectProfitSources(businessId: string, projectId?: string): Promise<ProjectProfitSourceRow[]> {
    const projects = await this.prisma.project.findMany({
      where: { businessId, status: { not: "CANCELLED" }, ...(projectId ? { id: projectId } : {}) },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, status: true, tenderId: true },
    });
    if (projects.length === 0) return [];
    const projectIds = projects.map((p) => p.id);
    const projectByTender = new Map(projects.map((p) => [p.tenderId, p.id]));
    const tenderIds = [...projectByTender.keys()];

    const [clientPoItems, bills, vendorPoItems, freight, expenses, labor] = await Promise.all([
      this.prisma.clientPurchaseOrderItem.findMany({
        where: { clientPurchaseOrder: { businessId, projectId: { in: projectIds } } },
        select: { quantity: true, rate: true, clientPurchaseOrder: { select: { projectId: true } } },
      }),
      this.prisma.bill.findMany({
        where: { businessId, tenderId: { in: tenderIds } },
        select: { id: true, tenderId: true, items: { select: { quantity: true, rate: true } } },
      }),
      this.prisma.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: {
            businessId,
            tenderId: { in: tenderIds },
            status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] },
          },
        },
        select: { amount: true, purchaseOrder: { select: { tenderId: true } } },
      }),
      this.prisma.shipment.groupBy({
        by: ["projectId"],
        where: { businessId, projectId: { in: projectIds } },
        _sum: { freightCost: true },
      }),
      this.prisma.expense.groupBy({
        by: ["projectId"],
        where: { businessId, projectId: { in: projectIds } },
        _sum: { amount: true },
      }),
      this.prisma.projectLaborEntry.groupBy({
        by: ["projectId"],
        where: { projectId: { in: projectIds } },
        _sum: { amount: true },
      }),
    ]);
    const payments = bills.length
      ? await this.prisma.payment.groupBy({
          by: ["entityId"],
          where: { businessId, entityType: "Bill", direction: "RECEIVED", entityId: { in: bills.map((b) => b.id) } },
          _sum: { amount: true },
        })
      : [];
    const receivedByBill = new Map(payments.map((p) => [p.entityId, p._sum.amount ?? 0]));

    const rows = new Map<string, ProjectProfitSourceRow>(
      projects.map((p) => [
        p.id,
        { id: p.id, name: p.name, status: p.status, clientPoValue: 0, billed: 0, received: 0, vendorCost: 0, freight: 0, otherCosts: 0 },
      ]),
    );
    const add = (projectId: string | null | undefined, key: keyof ProjectProfitSourceRow, amount: number) => {
      const row = projectId ? rows.get(projectId) : undefined;
      if (row) (row[key] as number) += amount;
    };
    for (const item of clientPoItems) add(item.clientPurchaseOrder.projectId, "clientPoValue", item.quantity * item.rate);
    for (const bill of bills) {
      const projectOfBill = projectByTender.get(bill.tenderId);
      add(projectOfBill, "billed", bill.items.reduce((sum, item) => sum + item.quantity * item.rate, 0));
      add(projectOfBill, "received", receivedByBill.get(bill.id) ?? 0);
    }
    for (const item of vendorPoItems) add(projectByTender.get(item.purchaseOrder.tenderId!), "vendorCost", item.amount);
    for (const row of freight) add(row.projectId, "freight", row._sum.freightCost ?? 0);
    for (const row of expenses) add(row.projectId, "otherCosts", row._sum.amount ?? 0);
    for (const row of labor) add(row.projectId, "otherCosts", row._sum.amount ?? 0);
    return [...rows.values()];
  }

  findPaymentsForSummary(businessId: string, from?: Date, to?: Date): Promise<PaymentBasicRow[]> {
    return this.prisma.payment.findMany({
      where: { businessId, paymentDate: from || to ? { gte: from, lte: to } : undefined },
      select: { direction: true, amount: true, paymentDate: true },
    });
  }

  findVendorsBasic(): Promise<{ id: string; name: string }[]> {
    return this.prisma.vendor.findMany({ select: { id: true, name: true } });
  }

  findVendorRatings(businessId: string): Promise<{ vendorId: string; rating: number }[]> {
    return this.prisma.vendorRating.findMany({
      where: { purchaseOrder: { businessId } },
      select: { vendorId: true, rating: true },
    });
  }

  findPurchaseOrdersForOnTimeCalc(businessId: string): Promise<PurchaseOrderForOnTimeRow[]> {
    return this.prisma.purchaseOrder.findMany({
      where: { businessId, expectedDeliveryDate: { not: null } },
      select: { id: true, vendorId: true, expectedDeliveryDate: true },
    });
  }

  findLatestGoodsReceiptDatesByPoIds(
    businessId: string,
    poIds: string[],
  ): Promise<{ purchaseOrderId: string; receivedDate: Date }[]> {
    if (poIds.length === 0) return Promise.resolve([]);
    return this.prisma.goodsReceipt.findMany({
      where: { businessId, purchaseOrderId: { in: poIds } },
      orderBy: { receivedDate: "desc" },
      select: { purchaseOrderId: true, receivedDate: true },
    });
  }

  async countPurchaseOrdersByVendor(businessId: string): Promise<{ vendorId: string; count: number }[]> {
    const groups = await this.prisma.purchaseOrder.groupBy({ where: { businessId }, by: ["vendorId"], _count: { _all: true } });
    return groups.map((g) => ({ vendorId: g.vendorId, count: g._count._all }));
  }

  findAllInvoiceTotals(businessId: string): Promise<{ totalAmount: number; invoiceDate: Date }[]> {
    return this.prisma.invoice.findMany({ where: { businessId }, select: { totalAmount: true, invoiceDate: true } });
  }

  async sumPaymentsByEntityType(businessId: string, entityType: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { businessId, entityType },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  findGoodsReceiptLeadTimes(businessId: string): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]> {
    return this.prisma.goodsReceipt
      .findMany({
        where: { businessId },
        select: { receivedDate: true, purchaseOrder: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ purchaseOrderCreatedAt: r.purchaseOrder.createdAt, receivedDate: r.receivedDate })));
  }

  findBoqCreationLeadTimes(businessId: string): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]> {
    return this.prisma.boq
      .findMany({
        where: { businessId, isCurrent: true },
        select: { createdAt: true, tender: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ tenderCreatedAt: r.tender.createdAt, boqCreatedAt: r.createdAt })));
  }

  searchTenders(businessId: string, query: string): Promise<{ id: string; tenderNumber: string; title: string }[]> {
    return this.prisma.tender.findMany({
      where: {
        businessId,
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

  searchProjects(businessId: string, query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.project.findMany({
      where: { businessId, name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }

  findTenderIdsForBusiness(businessId: string): Promise<{ id: string; tenderNumber: string }[]> {
    return this.prisma.tender.findMany({
      where: { businessId },
      select: { id: true, tenderNumber: true },
    });
  }

  async searchAttachmentsByMetadata(tenderIds: string[], query: string): Promise<AttachmentMetadataRow[]> {
    if (tenderIds.length === 0) return [];
    const rows = await this.prisma.attachment.findMany({
      where: {
        entityType: "Tender",
        entityId: { in: tenderIds },
        variant: "ORIGINAL",
        OR: [
          { originalName: { contains: query, mode: "insensitive" } },
          { documentType: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, originalName: true, documentType: true, entityId: true },
      take: SEARCH_LIMIT,
    });
    return rows.map((row) => ({ ...row, entityId: row.entityId! }));
  }

  async findNearestAttachments(
    tenderIds: string[],
    queryVector: number[],
    limit: number,
    threshold: number,
  ): Promise<(AttachmentMetadataRow & { similarity: number })[]> {
    if (tenderIds.length === 0) return [];
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "originalName", "documentType", "entityId",
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM attachments
      WHERE "entityType" = 'Tender' AND "entityId" = ANY(${tenderIds})
        AND variant = 'ORIGINAL' AND "embeddingVector" IS NOT NULL
        AND 1 - ("embeddingVector" <=> ${vectorLiteral}::vector) >= ${threshold}
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
}
