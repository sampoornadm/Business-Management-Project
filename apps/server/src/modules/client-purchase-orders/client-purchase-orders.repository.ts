import type { Prisma, PrismaClient } from "@bmp/database";
import type { TenderWonItemDto } from "@bmp/types";

import type { BoqLine } from "./client-purchase-orders.checks.js";

const clientPoArgs = {
  include: {
    items: { orderBy: { sortOrder: "asc" } },
    createdBy: { select: { id: true, firstName: true, lastName: true } },
  },
} satisfies Prisma.ClientPurchaseOrderDefaultArgs;

export type ClientPurchaseOrderWithItems = Prisma.ClientPurchaseOrderGetPayload<typeof clientPoArgs>;

export interface ProjectForClientPo {
  id: string;
  tenderId: string;
  deliveryPeriodDays: number;
  wonItems: TenderWonItemDto[];
}

export interface ClientPoItemData {
  /** An existing line's id (update keeps it); absent = new line. */
  id?: string;
  boqItemId: string | null;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  sortOrder: number;
}

export interface ClientPoData {
  poNumber: string;
  poDate: Date;
  deliveryDueDate: Date;
  notes: string | null;
}

export interface IClientPurchaseOrdersRepository {
  findProject(projectId: string, businessId: string): Promise<ProjectForClientPo | null>;
  /** Leaf lines of the tender's current BOQ (a parent heading is not orderable). */
  findCurrentBoqLines(tenderId: string, businessId: string): Promise<BoqLine[]>;
  findManyByProject(projectId: string, businessId: string): Promise<ClientPurchaseOrderWithItems[]>;
  findById(id: string, businessId: string): Promise<ClientPurchaseOrderWithItems | null>;
  findByPoNumber(poNumber: string, businessId: string): Promise<{ id: string } | null>;
  create(
    data: ClientPoData & { businessId: string; projectId: string; createdById: string },
    items: ClientPoItemData[],
  ): Promise<string>;
  /**
   * `items`, when given, becomes the PO's full set of lines: lines with an id are updated in
   * place, lines without one are created, and lines left out are deleted (a shipped line cannot
   * be, its shipment items reference it with onDelete Restrict, so the transaction fails).
   */
  update(id: string, data: Partial<ClientPoData>, items?: ClientPoItemData[]): Promise<void>;
  delete(id: string): Promise<void>;
  /** Σ shipped quantity per line of the PO, over every shipment (dispatched or not). */
  shippedQuantityByItem(clientPurchaseOrderId: string): Promise<Map<string, number>>;
}

export class ClientPurchaseOrdersRepository implements IClientPurchaseOrdersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProject(projectId: string, businessId: string): Promise<ProjectForClientPo | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, businessId },
      select: { id: true, tenderId: true, tender: { select: { deliveryPeriodDays: true, wonItems: true } } },
    });
    if (!project) return null;
    return {
      id: project.id,
      tenderId: project.tenderId,
      deliveryPeriodDays: project.tender.deliveryPeriodDays,
      wonItems: Array.isArray(project.tender.wonItems)
        ? (project.tender.wonItems as unknown as TenderWonItemDto[])
        : [],
    };
  }

  async findCurrentBoqLines(tenderId: string, businessId: string): Promise<BoqLine[]> {
    const items = await this.prisma.boqItem.findMany({
      where: { boq: { tenderId, businessId, isCurrent: true } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, parentId: true, itemCode: true, description: true, unit: true, quantity: true, rate: true },
    });
    const parents = new Set(items.map((item) => item.parentId).filter(Boolean));
    return items
      .filter((item) => !parents.has(item.id))
      .map(({ parentId: _parentId, ...line }) => line);
  }

  findManyByProject(projectId: string, businessId: string): Promise<ClientPurchaseOrderWithItems[]> {
    return this.prisma.clientPurchaseOrder.findMany({
      where: { projectId, businessId },
      orderBy: { poDate: "asc" },
      ...clientPoArgs,
    });
  }

  findById(id: string, businessId: string): Promise<ClientPurchaseOrderWithItems | null> {
    return this.prisma.clientPurchaseOrder.findFirst({ where: { id, businessId }, ...clientPoArgs });
  }

  findByPoNumber(poNumber: string, businessId: string): Promise<{ id: string } | null> {
    return this.prisma.clientPurchaseOrder.findFirst({ where: { poNumber, businessId }, select: { id: true } });
  }

  async create(
    data: ClientPoData & { businessId: string; projectId: string; createdById: string },
    items: ClientPoItemData[],
  ): Promise<string> {
    const created = await this.prisma.clientPurchaseOrder.create({
      data: { ...data, items: { create: items } },
      select: { id: true },
    });
    return created.id;
  }

  async update(id: string, data: Partial<ClientPoData>, items?: ClientPoItemData[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.clientPurchaseOrder.update({ where: { id }, data });
      if (!items) return;
      const keptIds = items.flatMap((item) => (item.id ? [item.id] : []));
      await tx.clientPurchaseOrderItem.deleteMany({ where: { clientPurchaseOrderId: id, id: { notIn: keptIds } } });
      for (const { id: itemId, ...line } of items) {
        if (itemId) {
          await tx.clientPurchaseOrderItem.updateMany({ where: { id: itemId, clientPurchaseOrderId: id }, data: line });
        } else {
          await tx.clientPurchaseOrderItem.create({ data: { ...line, clientPurchaseOrderId: id } });
        }
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.clientPurchaseOrder.delete({ where: { id } });
  }

  async shippedQuantityByItem(clientPurchaseOrderId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.shipmentItem.groupBy({
      by: ["clientPoItemId"],
      where: { clientPoItem: { clientPurchaseOrderId } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((row) => [row.clientPoItemId, row._sum.quantity ?? 0]));
  }
}
