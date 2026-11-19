import type { Prisma, PrismaClient } from "@bmp/database";

import type { ClientPoLine, ShippedLine, VendorPoLine } from "./shipments.logic.js";

const shipmentArgs = {
  include: {
    clientPurchaseOrder: { select: { poNumber: true } },
    items: {
      include: {
        clientPoItem: {
          select: { boqItemId: true, description: true, unit: true, rate: true, sortOrder: true },
        },
      },
    },
    bill: { select: { id: true, billNumber: true, items: { select: { quantity: true, rate: true } } } },
  },
} satisfies Prisma.ShipmentDefaultArgs;

export type ShipmentWithDetails = Prisma.ShipmentGetPayload<typeof shipmentArgs>;

export interface ShipmentProject {
  id: string;
  tenderId: string;
}

export interface ClientPoLineWithOrder extends ClientPoLine {
  clientPurchaseOrderId: string;
  rate: number;
}

export type ShipmentFieldsData = Partial<{
  ewayBillNumber: string | null;
  ewayBillDate: Date | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  freightCost: number | null;
  dispatchedAt: Date | null;
  grnNumber: string | null;
  grnDate: Date | null;
  billId: string | null;
  settledAt: Date | null;
  notes: string | null;
}>;

export interface IShipmentsRepository {
  findProject(projectId: string, businessId: string): Promise<ShipmentProject | null>;
  findClientPoLines(projectId: string, businessId: string): Promise<ClientPoLineWithOrder[]>;
  findVendorPoLines(tenderId: string, businessId: string): Promise<VendorPoLine[]>;
  findClientPurchaseOrders(projectId: string, businessId: string): Promise<{ id: string; poNumber: string }[]>;
  findVendorPurchaseOrders(
    tenderId: string,
    businessId: string,
  ): Promise<{ id: string; poNumber: string; vendorName: string; total: number }[]>;
  findShippedLines(projectId: string, businessId: string): Promise<(ShippedLine & { shipmentId: string })[]>;
  findManyByProject(projectId: string, businessId: string): Promise<ShipmentWithDetails[]>;
  findById(id: string, businessId: string): Promise<ShipmentWithDetails | null>;
  sumPaymentsByBill(billIds: string[], businessId: string): Promise<Map<string, number>>;
  create(
    data: { businessId: string; projectId: string; clientPurchaseOrderId: string; notes: string | null; createdById: string },
    items: { clientPoItemId: string; quantity: number }[],
  ): Promise<string>;
  update(id: string, data: ShipmentFieldsData, items?: { clientPoItemId: string; quantity: number }[]): Promise<void>;
  delete(id: string): Promise<void>;
}

export class ShipmentsRepository implements IShipmentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findProject(projectId: string, businessId: string): Promise<ShipmentProject | null> {
    return this.prisma.project.findFirst({ where: { id: projectId, businessId }, select: { id: true, tenderId: true } });
  }

  findClientPoLines(projectId: string, businessId: string): Promise<ClientPoLineWithOrder[]> {
    return this.prisma.clientPurchaseOrderItem.findMany({
      where: { clientPurchaseOrder: { projectId, businessId } },
      orderBy: [{ clientPurchaseOrder: { poDate: "asc" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        clientPurchaseOrderId: true,
        boqItemId: true,
        itemCode: true,
        description: true,
        unit: true,
        quantity: true,
        rate: true,
      },
    });
  }

  async findVendorPoLines(tenderId: string, businessId: string): Promise<VendorPoLine[]> {
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: { boqItemId: { not: null }, purchaseOrder: { tenderId, businessId } },
      orderBy: { purchaseOrder: { createdAt: "asc" } },
      select: {
        boqItemId: true,
        quantity: true,
        receivedQuantity: true,
        purchaseOrder: { select: { id: true, poNumber: true, status: true, vendor: { select: { name: true } } } },
      },
    });
    return items.map((item) => ({
      boqItemId: item.boqItemId,
      purchaseOrderId: item.purchaseOrder.id,
      poNumber: item.purchaseOrder.poNumber,
      vendorName: item.purchaseOrder.vendor.name,
      status: item.purchaseOrder.status,
      quantity: item.quantity,
      receivedQuantity: item.receivedQuantity,
    }));
  }

  findClientPurchaseOrders(projectId: string, businessId: string): Promise<{ id: string; poNumber: string }[]> {
    return this.prisma.clientPurchaseOrder.findMany({ where: { projectId, businessId }, select: { id: true, poNumber: true } });
  }

  async findVendorPurchaseOrders(
    tenderId: string,
    businessId: string,
  ): Promise<{ id: string; poNumber: string; vendorName: string; total: number }[]> {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenderId, businessId, status: { not: "CANCELLED" } },
      select: { id: true, poNumber: true, vendor: { select: { name: true } }, items: { select: { amount: true } } },
    });
    return orders.map((order) => ({
      id: order.id,
      poNumber: order.poNumber,
      vendorName: order.vendor.name,
      total: order.items.reduce((sum, item) => sum + item.amount, 0),
    }));
  }

  async findShippedLines(projectId: string, businessId: string): Promise<(ShippedLine & { shipmentId: string })[]> {
    const items = await this.prisma.shipmentItem.findMany({
      where: { shipment: { projectId, businessId } },
      select: {
        shipmentId: true,
        clientPoItemId: true,
        quantity: true,
        shipment: { select: { dispatchedAt: true, grnNumber: true } },
      },
    });
    return items.map((item) => ({
      shipmentId: item.shipmentId,
      clientPoItemId: item.clientPoItemId,
      quantity: item.quantity,
      dispatched: item.shipment.dispatchedAt !== null,
      accepted: item.shipment.grnNumber !== null,
    }));
  }

  findManyByProject(projectId: string, businessId: string): Promise<ShipmentWithDetails[]> {
    return this.prisma.shipment.findMany({ where: { projectId, businessId }, orderBy: { number: "asc" }, ...shipmentArgs });
  }

  findById(id: string, businessId: string): Promise<ShipmentWithDetails | null> {
    return this.prisma.shipment.findFirst({ where: { id, businessId }, ...shipmentArgs });
  }

  async sumPaymentsByBill(billIds: string[], businessId: string): Promise<Map<string, number>> {
    if (billIds.length === 0) return new Map();
    const rows = await this.prisma.payment.groupBy({
      by: ["entityId"],
      where: { businessId, entityType: "Bill", entityId: { in: billIds } },
      _sum: { amount: true },
    });
    return new Map(rows.map((row) => [row.entityId, row._sum.amount ?? 0]));
  }

  async create(
    data: { businessId: string; projectId: string; clientPurchaseOrderId: string; notes: string | null; createdById: string },
    items: { clientPoItemId: string; quantity: number }[],
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.shipment.aggregate({ where: { projectId: data.projectId }, _max: { number: true } });
      const created = await tx.shipment.create({
        data: { ...data, number: (last._max.number ?? 0) + 1, items: { create: items } },
        select: { id: true },
      });
      return created.id;
    });
  }

  async update(id: string, data: ShipmentFieldsData, items?: { clientPoItemId: string; quantity: number }[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.shipment.update({ where: { id }, data }),
      ...(items
        ? [
            this.prisma.shipmentItem.deleteMany({ where: { shipmentId: id } }),
            this.prisma.shipmentItem.createMany({ data: items.map((item) => ({ ...item, shipmentId: id })) }),
          ]
        : []),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.shipment.delete({ where: { id } });
  }
}
