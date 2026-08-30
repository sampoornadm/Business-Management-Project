import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { IRfqRepository, RfqDetail } from "../../rfq/rfq.repository.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type { IVendorsRepository } from "../../vendors/vendors.repository.js";
import type {
  CreateGoodsReceiptData,
  CreatePurchaseOrderData,
  IPurchaseOrdersRepository,
  PurchaseOrderDetail,
  PurchaseOrderFilters,
} from "../purchase-orders.repository.js";
import { PurchaseOrdersService } from "../purchase-orders.service.js";

const CREATOR = { id: randomUUID(), firstName: "Priya", lastName: "Purchase" };

class FakePurchaseOrdersRepository implements IPurchaseOrdersRepository {
  purchaseOrders = new Map<string, PurchaseOrderDetail>();

  async create(data: CreatePurchaseOrderData) {
    const id = randomUUID();
    const po: PurchaseOrderDetail = {
      id,
      poNumber: `PO-${id.slice(0, 8).toUpperCase()}`,
      vendor: { id: data.vendorId, name: "Ace Steel Suppliers" },
      tenderId: data.tenderId ?? null,
      sourceRfqId: data.sourceRfqId ?? null,
      status: "DRAFT",
      expectedDeliveryDate: data.expectedDeliveryDate ?? null,
      notes: data.notes ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        purchaseOrderId: id,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
        receivedQuantity: 0,
        sortOrder: item.sortOrder ?? index,
      })),
      goodsReceipts: [],
      vendorRating: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as PurchaseOrderDetail;
    this.purchaseOrders.set(id, po);
    return id;
  }

  // businessId is ignored here — the fake stands in for the real (Postgres-
  // enforced) scoping; isolation itself is covered by the integration test.
  async findById(id: string, _businessId: string) {
    return this.purchaseOrders.get(id) ?? null;
  }

  async findMany(_pagination: unknown, filters: PurchaseOrderFilters) {
    let items = [...this.purchaseOrders.values()];
    if (filters.status) items = items.filter((po) => po.status === filters.status);
    return { items: items as never, totalItems: items.length };
  }

  async updateStatus(id: string, status: PurchaseOrderDetail["status"]) {
    const po = this.purchaseOrders.get(id);
    if (!po) throw new Error("not found");
    po.status = status;
  }

  async createGoodsReceipt(data: CreateGoodsReceiptData) {
    const po = this.purchaseOrders.get(data.purchaseOrderId);
    if (!po) throw new Error("not found");
    const grnId = randomUUID();
    const receiptItems = data.items.map((item) => ({
      id: randomUUID(),
      purchaseOrderItemId: item.purchaseOrderItemId,
      quantityReceived: item.quantityReceived,
      remarks: item.remarks ?? null,
    }));
    (po.goodsReceipts as unknown[]).unshift({
      id: grnId,
      receivedDate: data.receivedDate,
      remarks: data.remarks ?? null,
      receivedBy: CREATOR,
      items: receiptItems,
      createdAt: new Date(),
    });
    for (const item of data.items) {
      const poItem = po.items.find((i) => i.id === item.purchaseOrderItemId);
      if (poItem) poItem.receivedQuantity += item.quantityReceived;
    }
    return grnId;
  }

  async upsertVendorRating(
    purchaseOrderId: string,
    vendorId: string,
    ratedById: string,
    rating: number,
    remarks?: string | null,
  ) {
    const po = this.purchaseOrders.get(purchaseOrderId);
    if (!po) throw new Error("not found");
    (po as unknown as { vendorRating: unknown }).vendorRating = {
      id: randomUUID(),
      purchaseOrderId,
      vendorId,
      ratedById,
      rating,
      remarks: remarks ?? null,
      createdAt: new Date(),
    };
  }
}

class FakeRfqRepository implements Partial<IRfqRepository> {
  rfqs = new Map<string, RfqDetail>();
  async findById(id: string, _businessId: string) {
    return this.rfqs.get(id) ?? null;
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenderIds = new Set<string>();
  async findById(id: string, _businessId: string) {
    return this.tenderIds.has(id) ? ({ id } as never) : null;
  }
}

class FakeVendorsRepository implements Partial<IVendorsRepository> {
  vendorIds = new Set<string>();
  async findById(id: string) {
    return this.vendorIds.has(id) ? ({ id } as never) : null;
  }
}

describe("PurchaseOrdersService", () => {
  let repository: FakePurchaseOrdersRepository;
  let rfqRepository: FakeRfqRepository;
  let tendersRepository: FakeTendersRepository;
  let vendorsRepository: FakeVendorsRepository;
  let auditService: AuditService;
  let service: PurchaseOrdersService;
  const actorId = randomUUID();
  const vendorId = randomUUID();
  const businessId = randomUUID();

  beforeEach(() => {
    repository = new FakePurchaseOrdersRepository();
    rfqRepository = new FakeRfqRepository();
    tendersRepository = new FakeTendersRepository();
    vendorsRepository = new FakeVendorsRepository();
    vendorsRepository.vendorIds.add(vendorId);
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new PurchaseOrdersService(
      repository as unknown as IPurchaseOrdersRepository,
      rfqRepository as unknown as IRfqRepository,
      tendersRepository as unknown as ITendersRepository,
      vendorsRepository as unknown as IVendorsRepository,
      auditService,
    );
  });

  async function createBasicPo() {
    return service.create(
      {
        vendorId,
        items: [{ description: "OPC Cement", unit: "bag", quantity: 100, rate: 380 }],
      },
      actorId,
      { businessId },
    );
  }

  it("creates a purchase order with a server-computed amount", async () => {
    const po = await service.create(
      { vendorId, items: [{ description: "Cement", quantity: 100, rate: 380 }] },
      actorId,
      { businessId },
    );
    expect(po.items[0]!.amount).toBe(38000);
    expect(po.totalAmount).toBe(38000);
    expect(po.status).toBe("DRAFT");
  });

  it("rejects creating a PO for an unknown vendor", async () => {
    await expect(
      service.create(
        { vendorId: randomUUID(), items: [{ description: "X", quantity: 1, rate: 1 }] },
        actorId,
        { businessId },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("issues a draft purchase order", async () => {
    const po = await createBasicPo();
    const issued = await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    expect(issued.status).toBe("ISSUED");
  });

  it("rejects issuing a non-draft purchase order", async () => {
    const po = await createBasicPo();
    await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    await expect(service.updateStatus(po.id, "ISSUED", actorId, businessId)).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects recording a goods receipt before the PO is issued", async () => {
    const po = await createBasicPo();
    await expect(
      service.createGoodsReceipt(
        po.id,
        { items: [{ purchaseOrderItemId: po.items[0]!.id, quantityReceived: 10 }] },
        actorId,
        businessId,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("moves through PARTIALLY_RECEIVED to RECEIVED across two goods receipts", async () => {
    const po = await createBasicPo();
    await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    const itemId = po.items[0]!.id;

    const afterFirst = await service.createGoodsReceipt(
      po.id,
      { items: [{ purchaseOrderItemId: itemId, quantityReceived: 40 }] },
      actorId,
      businessId,
    );
    expect(afterFirst.status).toBe("PARTIALLY_RECEIVED");
    expect(afterFirst.items[0]!.receivedQuantity).toBe(40);

    const afterSecond = await service.createGoodsReceipt(
      po.id,
      { items: [{ purchaseOrderItemId: itemId, quantityReceived: 60 }] },
      actorId,
      businessId,
    );
    expect(afterSecond.status).toBe("RECEIVED");
    expect(afterSecond.items[0]!.receivedQuantity).toBe(100);
    expect(afterSecond.goodsReceipts).toHaveLength(2);
  });

  it("rejects a goods receipt that would exceed the ordered quantity", async () => {
    const po = await createBasicPo();
    await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    await expect(
      service.createGoodsReceipt(
        po.id,
        { items: [{ purchaseOrderItemId: po.items[0]!.id, quantityReceived: 150 }] },
        actorId,
        businessId,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("rejects a vendor rating before the PO is fully received", async () => {
    const po = await createBasicPo();
    await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    await expect(
      service.upsertVendorRating(po.id, { rating: 5 }, actorId, businessId),
    ).rejects.toThrow(ConflictError);
  });

  it("rates the vendor once the PO is fully received", async () => {
    const po = await createBasicPo();
    await service.updateStatus(po.id, "ISSUED", actorId, businessId);
    await service.createGoodsReceipt(
      po.id,
      { items: [{ purchaseOrderItemId: po.items[0]!.id, quantityReceived: 100 }] },
      actorId,
      businessId,
    );
    const rated = await service.upsertVendorRating(
      po.id,
      { rating: 4, remarks: "On time" },
      actorId,
      businessId,
    );
    expect(rated.vendorRating?.rating).toBe(4);
  });

  it("creates one PO per vendor when items are split across selected quotes", async () => {
    const rfqId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      tenderId: null,
      status: "CLOSED",
      items: [
        {
          id: itemA,
          description: "OPC Cement",
          unit: "bag",
          quantity: 200,
          quotes: [{ vendorId: "vendor-a", rate: 375, isSelected: true, regretted: false }],
        },
        {
          id: itemB,
          description: "TMT Steel",
          unit: "ton",
          quantity: 10,
          quotes: [{ vendorId: "vendor-b", rate: 61000, isSelected: true, regretted: false }],
        },
      ],
    } as unknown as RfqDetail);
    vendorsRepository.vendorIds.add("vendor-a");
    vendorsRepository.vendorIds.add("vendor-b");

    const pos = await service.createFromRfq(rfqId, {}, actorId, { businessId });
    expect(pos).toHaveLength(2);
    const vendorAPo = pos.find((po) => po.items.some((i) => i.description === "OPC Cement"))!;
    const vendorBPo = pos.find((po) => po.items.some((i) => i.description === "TMT Steel"))!;
    expect(vendorAPo.items).toHaveLength(1);
    expect(vendorBPo.items).toHaveLength(1);
    expect(vendorAPo.sourceRfqId).toBe(rfqId);
  });

  it("excludes items with no selected quote rather than failing the whole call", async () => {
    const rfqId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      tenderId: null,
      status: "CLOSED",
      items: [
        {
          id: itemA,
          description: "OPC Cement",
          unit: "bag",
          quantity: 200,
          quotes: [{ vendorId: "vendor-a", rate: 375, isSelected: true, regretted: false }],
        },
        {
          id: itemB,
          description: "Unresolved Item",
          unit: "nos",
          quantity: 5,
          quotes: [{ vendorId: "vendor-a", rate: 100, isSelected: false, regretted: false }],
        },
      ],
    } as unknown as RfqDetail);
    vendorsRepository.vendorIds.add("vendor-a");

    const pos = await service.createFromRfq(rfqId, {}, actorId, { businessId });
    expect(pos).toHaveLength(1);
    expect(pos[0]!.items).toHaveLength(1);
    expect(pos[0]!.items[0]!.description).toBe("OPC Cement");
  });

  it("rejects creating a PO from an RFQ that isn't closed", async () => {
    const rfqId = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      status: "SENT",
      items: [],
    } as unknown as RfqDetail);

    await expect(service.createFromRfq(rfqId, {}, actorId, { businessId })).rejects.toThrow(
      ConflictError,
    );
  });

  it("throws for an unknown purchase order id", async () => {
    await expect(service.getById(randomUUID(), businessId)).rejects.toThrow(NotFoundError);
  });
});
