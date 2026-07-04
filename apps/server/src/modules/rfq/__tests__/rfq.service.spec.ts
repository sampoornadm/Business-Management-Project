import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type { IVendorsRepository } from "../../vendors/vendors.repository.js";
import type {
  CreateRfqData,
  IRfqRepository,
  RfqDetail,
  RfqFilters,
  UpdateRfqData,
} from "../rfq.repository.js";
import { RfqService } from "../rfq.service.js";

const CREATOR = { id: randomUUID(), firstName: "Priya", lastName: "Purchase" };

class FakeRfqRepository implements IRfqRepository {
  rfqs = new Map<string, RfqDetail>();

  async create(data: CreateRfqData) {
    const id = randomUUID();
    const rfq: RfqDetail = {
      id,
      title: data.title,
      tenderId: data.tenderId ?? null,
      status: "DRAFT",
      dueDate: data.dueDate ?? null,
      awardedVendorId: null,
      createdById: data.createdById,
      createdBy: CREATOR,
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        rfqId: id,
        boqItemId: item.boqItemId ?? null,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        sortOrder: item.sortOrder ?? index,
        quotes: [],
      })),
      vendorInvites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as RfqDetail;
    this.rfqs.set(id, rfq);
    return id;
  }

  async findById(id: string) {
    return this.rfqs.get(id) ?? null;
  }

  async findMany(_pagination: unknown, filters: RfqFilters) {
    let items = [...this.rfqs.values()];
    if (filters.status) items = items.filter((r) => r.status === filters.status);
    return { items: items as never, totalItems: items.length };
  }

  async update(id: string, data: UpdateRfqData) {
    const rfq = this.rfqs.get(id);
    if (!rfq) throw new Error("not found");
    Object.assign(rfq, data);
  }

  async updateStatus(id: string, status: RfqDetail["status"]) {
    const rfq = this.rfqs.get(id);
    if (!rfq) throw new Error("not found");
    rfq.status = status;
  }

  async setAwardedVendor(id: string, vendorId: string) {
    const rfq = this.rfqs.get(id);
    if (!rfq) throw new Error("not found");
    rfq.awardedVendorId = vendorId;
    rfq.status = "AWARDED";
  }

  async findVendorInvite(rfqId: string, vendorId: string) {
    const rfq = this.rfqs.get(rfqId);
    const invite = rfq?.vendorInvites.find((v) => v.vendor.id === vendorId);
    return invite ? { id: invite.id } : null;
  }

  async addVendorInvite(rfqId: string, vendorId: string) {
    const rfq = this.rfqs.get(rfqId);
    if (!rfq) throw new Error("not found");
    (rfq.vendorInvites as unknown[]).push({
      id: randomUUID(),
      vendor: { id: vendorId, name: `Vendor ${vendorId.slice(0, 4)}` },
      status: "INVITED",
      createdAt: new Date(),
    });
  }

  async updateVendorInviteStatus(rfqId: string, vendorId: string, status: never) {
    const rfq = this.rfqs.get(rfqId);
    const invite = rfq?.vendorInvites.find((v) => v.vendor.id === vendorId);
    if (invite) invite.status = status;
  }

  async removeVendorInvite(rfqId: string, vendorId: string) {
    const rfq = this.rfqs.get(rfqId);
    if (!rfq) return;
    rfq.vendorInvites = rfq.vendorInvites.filter((v) => v.vendor.id !== vendorId) as never;
  }

  async findItemById(itemId: string) {
    for (const rfq of this.rfqs.values()) {
      const item = rfq.items.find((i) => i.id === itemId);
      if (item) return { id: item.id, rfqId: rfq.id, quantity: item.quantity };
    }
    return null;
  }

  async upsertQuote(rfqItemId: string, vendorId: string, rate: number, remarks?: string | null) {
    for (const rfq of this.rfqs.values()) {
      const item = rfq.items.find((i) => i.id === rfqItemId);
      if (!item) continue;
      const vendorName =
        rfq.vendorInvites.find((v) => v.vendor.id === vendorId)?.vendor.name ?? "Vendor";
      const existing = item.quotes.find((q) => q.vendorId === vendorId);
      if (existing) {
        existing.rate = rate;
        existing.remarks = remarks ?? null;
      } else {
        (item.quotes as unknown[]).push({
          id: randomUUID(),
          rfqItemId,
          vendorId,
          vendor: { id: vendorId, name: vendorName },
          rate,
          remarks: remarks ?? null,
          updatedAt: new Date(),
        });
      }
    }
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenderIds = new Set<string>();
  async findById(id: string) {
    return this.tenderIds.has(id) ? ({ id } as never) : null;
  }
}

class FakeVendorsRepository implements Partial<IVendorsRepository> {
  vendorIds = new Set<string>();
  async findById(id: string) {
    return this.vendorIds.has(id) ? ({ id } as never) : null;
  }
}

describe("RfqService", () => {
  let repository: FakeRfqRepository;
  let tendersRepository: FakeTendersRepository;
  let vendorsRepository: FakeVendorsRepository;
  let auditService: AuditService;
  let service: RfqService;
  const actorId = randomUUID();
  const vendorA = randomUUID();
  const vendorB = randomUUID();

  beforeEach(() => {
    repository = new FakeRfqRepository();
    tendersRepository = new FakeTendersRepository();
    vendorsRepository = new FakeVendorsRepository();
    vendorsRepository.vendorIds.add(vendorA);
    vendorsRepository.vendorIds.add(vendorB);
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new RfqService(
      repository as unknown as IRfqRepository,
      tendersRepository as unknown as ITendersRepository,
      vendorsRepository as unknown as IVendorsRepository,
      auditService,
    );
  });

  async function createBasicRfq() {
    return service.create(
      { title: "Cement Supply RFQ", items: [{ description: "OPC Cement", unit: "bag", quantity: 500 }] },
      actorId,
    );
  }

  it("creates an RFQ with items", async () => {
    const rfq = await createBasicRfq();
    expect(rfq.status).toBe("DRAFT");
    expect(rfq.items).toHaveLength(1);
  });

  it("rejects an RFQ referencing an unknown tender", async () => {
    await expect(
      service.create(
        { title: "X", tenderId: randomUUID(), items: [{ description: "Item", quantity: 1 }] },
        actorId,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("moves DRAFT to SENT when a vendor is invited", async () => {
    const rfq = await createBasicRfq();
    const updated = await service.addVendorInvite(rfq.id, vendorA, actorId);
    expect(updated.status).toBe("SENT");
    expect(updated.vendorInvites).toHaveLength(1);
  });

  it("rejects inviting the same vendor twice", async () => {
    const rfq = await createBasicRfq();
    await service.addVendorInvite(rfq.id, vendorA, actorId);
    await expect(service.addVendorInvite(rfq.id, vendorA, actorId)).rejects.toThrow(ConflictError);
  });

  it("rejects a quote from a vendor that was not invited", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await expect(
      service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("records quotes and marks the vendor invite RESPONDED", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId);
    const updated = await service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId);
    expect(updated.vendorInvites[0]!.status).toBe("RESPONDED");
    expect(updated.items[0]!.quotes).toHaveLength(1);
  });

  it("computes the comparative statement with the lowest rate flagged per item", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId);
    await service.addVendorInvite(rfq.id, vendorB, actorId);
    await service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId);
    await service.upsertQuote(itemId, vendorB, { rate: 350 }, actorId);

    const comparison = await service.getComparison(rfq.id);
    expect(comparison.items).toHaveLength(1);
    const quoteA = comparison.items[0]!.quotes.find((q) => q.vendorId === vendorA)!;
    const quoteB = comparison.items[0]!.quotes.find((q) => q.vendorId === vendorB)!;
    expect(quoteA.isLowest).toBe(false);
    expect(quoteB.isLowest).toBe(true);
    expect(quoteB.amount).toBe(350 * 500);

    const totals = comparison.vendorTotals;
    expect(totals[0]!.vendorId).toBe(vendorB);
  });

  it("awards the RFQ to an invited vendor and rejects further quote/invite changes", async () => {
    const rfq = await createBasicRfq();
    await service.addVendorInvite(rfq.id, vendorA, actorId);
    const awarded = await service.award(rfq.id, vendorA, actorId);
    expect(awarded.status).toBe("AWARDED");
    expect(awarded.awardedVendorId).toBe(vendorA);

    await expect(service.addVendorInvite(rfq.id, vendorB, actorId)).rejects.toThrow(ConflictError);
  });

  it("rejects awarding to a vendor that was never invited", async () => {
    const rfq = await createBasicRfq();
    await expect(service.award(rfq.id, vendorA, actorId)).rejects.toThrow(BadRequestError);
  });

  it("closes an RFQ", async () => {
    const rfq = await createBasicRfq();
    const closed = await service.close(rfq.id, actorId);
    expect(closed.status).toBe("CLOSED");
  });

  it("throws for an unknown RFQ id", async () => {
    await expect(service.getById(randomUUID())).rejects.toThrow(NotFoundError);
  });
});
