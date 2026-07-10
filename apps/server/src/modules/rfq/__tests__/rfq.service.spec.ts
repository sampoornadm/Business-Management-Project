import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { EmailService } from "../../../infra/mailer/email.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { BoqItemWithBreakdown, IBoqRepository } from "../../boq/boq.repository.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type { IUsersRepository } from "../../users/users.repository.js";
import type { IVendorsRepository, VendorItemTypeMatch } from "../../vendors/vendors.repository.js";
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

  // businessId is ignored here — the fake stands in for the real (Postgres-
  // enforced) scoping; isolation itself is covered by the integration test.
  async findById(id: string, _businessId: string) {
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

  async reopen(id: string, status: RfqDetail["status"]) {
    const rfq = this.rfqs.get(id);
    if (!rfq) throw new Error("not found");
    rfq.status = status;
    rfq.awardedVendorId = null;
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
  tenderNumbers = new Map<string, string>();

  async findById(id: string, _businessId: string) {
    if (!this.tenderIds.has(id)) return null;
    return { id, tenderNumber: this.tenderNumbers.get(id) ?? "TND-0000" } as never;
  }
}

interface FakeVendorRecord {
  id: string;
  name: string;
  contacts: { name: string; email: string | null; isPrimary: boolean }[];
}

class FakeVendorsRepository implements Partial<IVendorsRepository> {
  vendorIds = new Set<string>();
  vendors = new Map<string, FakeVendorRecord>();
  itemTags: VendorItemTypeMatch[] = [];

  async findById(id: string) {
    if (this.vendors.has(id)) return this.vendors.get(id) as never;
    return this.vendorIds.has(id) ? ({ id, name: `Vendor ${id.slice(0, 4)}`, contacts: [] } as never) : null;
  }

  async findDistinctItemTypes() {
    return [...new Set(this.itemTags.map((tag) => tag.itemType))];
  }

  async findActiveVendorsByItemTypes(itemTypes: string[]) {
    return this.itemTags.filter((tag) => itemTypes.includes(tag.itemType));
  }
}

class FakeUsersRepository implements Partial<IUsersRepository> {
  users = new Map<string, { id: string; firstName: string; lastName: string; email: string }>();

  async findById(id: string, _businessId: string) {
    return (this.users.get(id) ?? null) as never;
  }
}

class FakeBoqRepository implements Partial<IBoqRepository> {
  items = new Map<string, BoqItemWithBreakdown>();

  async findItemsByIds(ids: string[], _businessId: string) {
    return ids.map((id) => this.items.get(id)).filter((item): item is BoqItemWithBreakdown => Boolean(item));
  }
}

describe("RfqService", () => {
  let repository: FakeRfqRepository;
  let tendersRepository: FakeTendersRepository;
  let vendorsRepository: FakeVendorsRepository;
  let boqRepository: FakeBoqRepository;
  let usersRepository: FakeUsersRepository;
  let emailService: { queueRfqEmail: ReturnType<typeof vi.fn> };
  let auditService: AuditService;
  let service: RfqService;
  const actorId = randomUUID();
  const vendorA = randomUUID();
  const vendorB = randomUUID();
  const businessId = randomUUID();

  beforeEach(() => {
    repository = new FakeRfqRepository();
    tendersRepository = new FakeTendersRepository();
    vendorsRepository = new FakeVendorsRepository();
    boqRepository = new FakeBoqRepository();
    usersRepository = new FakeUsersRepository();
    vendorsRepository.vendorIds.add(vendorA);
    vendorsRepository.vendorIds.add(vendorB);
    usersRepository.users.set(actorId, {
      id: actorId,
      firstName: "Priya",
      lastName: "PurchaseManager",
      email: "priya@bmp.local",
    });
    emailService = { queueRfqEmail: vi.fn().mockResolvedValue(undefined) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new RfqService(
      repository as unknown as IRfqRepository,
      tendersRepository as unknown as ITendersRepository,
      vendorsRepository as unknown as IVendorsRepository,
      boqRepository as unknown as IBoqRepository,
      usersRepository as unknown as IUsersRepository,
      emailService as unknown as EmailService,
      auditService,
    );
  });

  async function createBasicRfq() {
    return service.create(
      { title: "Cement Supply RFQ", items: [{ description: "OPC Cement", unit: "bag", quantity: 500 }] },
      actorId,
      { businessId },
    );
  }

  it("creates an RFQ with items", async () => {
    const rfq = await createBasicRfq();
    expect(rfq.status).toBe("DRAFT");
    expect(rfq.items).toHaveLength(1);
  });

  it("updates an RFQ's title and due date", async () => {
    const rfq = await createBasicRfq();
    const dueDate = new Date("2026-08-01T00:00:00.000Z");

    const updated = await service.update(rfq.id, { title: "Revised Cement Supply RFQ", dueDate }, actorId, businessId);

    expect(updated.title).toBe("Revised Cement Supply RFQ");
    expect(updated.dueDate).toBe(dueDate.toISOString());
  });

  it("rejects an RFQ referencing an unknown tender", async () => {
    await expect(
      service.create(
        { title: "X", tenderId: randomUUID(), items: [{ description: "Item", quantity: 1 }] },
        actorId,
        { businessId },
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("moves DRAFT to SENT when a vendor is invited", async () => {
    const rfq = await createBasicRfq();
    const updated = await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    expect(updated.status).toBe("SENT");
    expect(updated.vendorInvites).toHaveLength(1);
  });

  it("rejects inviting the same vendor twice", async () => {
    const rfq = await createBasicRfq();
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    await expect(service.addVendorInvite(rfq.id, vendorA, actorId, businessId)).rejects.toThrow(
      ConflictError,
    );
  });

  it("removes a vendor invite from an RFQ", async () => {
    const rfq = await createBasicRfq();
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    await service.addVendorInvite(rfq.id, vendorB, actorId, businessId);

    const updated = await service.removeVendorInvite(rfq.id, vendorA, actorId, businessId);

    expect(updated.vendorInvites).toHaveLength(1);
    expect(updated.vendorInvites[0]!.vendor.id).toBe(vendorB);
  });

  it("rejects removing an invite that doesn't exist for the RFQ", async () => {
    const rfq = await createBasicRfq();
    await expect(service.removeVendorInvite(rfq.id, vendorA, actorId, businessId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects a quote from a vendor that was not invited", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await expect(
      service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId, businessId),
    ).rejects.toThrow(BadRequestError);
  });

  it("records quotes and marks the vendor invite RESPONDED", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    const updated = await service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId, businessId);
    expect(updated.vendorInvites[0]!.status).toBe("RESPONDED");
    expect(updated.items[0]!.quotes).toHaveLength(1);
  });

  it("computes the comparative statement with the lowest rate flagged per item", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    await service.addVendorInvite(rfq.id, vendorB, actorId, businessId);
    await service.upsertQuote(itemId, vendorA, { rate: 380 }, actorId, businessId);
    await service.upsertQuote(itemId, vendorB, { rate: 350 }, actorId, businessId);

    const comparison = await service.getComparison(rfq.id, businessId);
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
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    const awarded = await service.award(rfq.id, vendorA, actorId, businessId);
    expect(awarded.status).toBe("AWARDED");
    expect(awarded.awardedVendorId).toBe(vendorA);

    await expect(service.addVendorInvite(rfq.id, vendorB, actorId, businessId)).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects awarding to a vendor that was never invited", async () => {
    const rfq = await createBasicRfq();
    await expect(service.award(rfq.id, vendorA, actorId, businessId)).rejects.toThrow(BadRequestError);
  });

  it("closes an RFQ", async () => {
    const rfq = await createBasicRfq();
    const closed = await service.close(rfq.id, actorId, businessId);
    expect(closed.status).toBe("CLOSED");
  });

  it("throws for an unknown RFQ id", async () => {
    await expect(service.getById(randomUUID(), businessId)).rejects.toThrow(NotFoundError);
  });

  describe("reopen", () => {
    it("reopens an AWARDED RFQ back to SENT and clears the awarded vendor", async () => {
      const rfq = await createBasicRfq();
      await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
      const awarded = await service.award(rfq.id, vendorA, actorId, businessId);
      expect(awarded.status).toBe("AWARDED");

      const reopened = await service.reopen(rfq.id, actorId, { businessId });
      expect(reopened.status).toBe("SENT");
      expect(reopened.awardedVendorId).toBeNull();
    });

    it("reopens a CLOSED RFQ with no vendor invites back to DRAFT", async () => {
      const rfq = await createBasicRfq();
      await service.close(rfq.id, actorId, businessId);

      const reopened = await service.reopen(rfq.id, actorId, { businessId });
      expect(reopened.status).toBe("DRAFT");
    });

    it("reopens a CLOSED RFQ that already had vendor invites back to SENT", async () => {
      const rfq = await createBasicRfq();
      await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
      await service.close(rfq.id, actorId, businessId);

      const reopened = await service.reopen(rfq.id, actorId, { businessId });
      expect(reopened.status).toBe("SENT");
    });

    it("rejects reopening an RFQ that isn't finalized", async () => {
      const rfq = await createBasicRfq();
      await expect(service.reopen(rfq.id, actorId, { businessId })).rejects.toThrow(BadRequestError);
    });
  });

  describe("suggestVendors", () => {
    function boqItem(id: string, description: string): BoqItemWithBreakdown {
      return { id, description } as unknown as BoqItemWithBreakdown;
    }

    it("suggests vendors whose tagged item type appears in the item description", async () => {
      const flangeItem = boqItem(randomUUID(), "FLANGE DESIGN SPECIFICATION : ASME B16.5 SLIP ON");
      boqRepository.items.set(flangeItem.id, flangeItem);
      vendorsRepository.itemTags = [
        { vendorId: vendorA, vendorName: "Vendor A", itemType: "FLANGE", make: null },
        { vendorId: vendorB, vendorName: "Vendor B", itemType: "GASKET", make: null },
      ];

      const result = await service.suggestVendors([flangeItem.id], businessId);

      expect(result.perItem).toHaveLength(1);
      expect(result.perItem[0]!.suggestedVendors).toEqual([
        { vendorId: vendorA, name: "Vendor A", itemType: "FLANGE" },
      ]);
      expect(result.recommended).toEqual([{ vendorId: vendorA, name: "Vendor A", coverageCount: 1 }]);
    });

    it("ranks the recommended vendor by how many selected items it covers", async () => {
      const flangeItem = boqItem(randomUUID(), "FLANGE, MILD STEEL");
      const gasketItem = boqItem(randomUUID(), "GASKET, RUBBER");
      boqRepository.items.set(flangeItem.id, flangeItem);
      boqRepository.items.set(gasketItem.id, gasketItem);
      vendorsRepository.itemTags = [
        { vendorId: vendorA, vendorName: "Vendor A", itemType: "FLANGE", make: null },
        { vendorId: vendorA, vendorName: "Vendor A", itemType: "GASKET", make: null },
        { vendorId: vendorB, vendorName: "Vendor B", itemType: "FLANGE", make: null },
      ];

      const result = await service.suggestVendors([flangeItem.id, gasketItem.id], businessId);

      expect(result.recommended[0]).toEqual({ vendorId: vendorA, name: "Vendor A", coverageCount: 2 });
      expect(result.recommended[1]).toEqual({ vendorId: vendorB, name: "Vendor B", coverageCount: 1 });
    });

    it("orders a vendor whose make also appears in the item text first", async () => {
      const item = boqItem(randomUUID(), "FLANGE, MAKE: ACME, MILD STEEL");
      boqRepository.items.set(item.id, item);
      vendorsRepository.itemTags = [
        { vendorId: vendorA, vendorName: "Vendor A", itemType: "FLANGE", make: null },
        { vendorId: vendorB, vendorName: "Vendor B", itemType: "FLANGE", make: "ACME" },
      ];

      const result = await service.suggestVendors([item.id], businessId);

      expect(result.perItem[0]!.suggestedVendors[0]!.vendorId).toBe(vendorB);
    });

    it("returns no suggestions when nothing in the description matches a tagged item type", async () => {
      const item = boqItem(randomUUID(), "SOME UNRELATED ITEM");
      boqRepository.items.set(item.id, item);
      vendorsRepository.itemTags = [{ vendorId: vendorA, vendorName: "Vendor A", itemType: "FLANGE", make: null }];

      const result = await service.suggestVendors([item.id], businessId);

      expect(result.perItem[0]!.suggestedVendors).toEqual([]);
      expect(result.recommended).toEqual([]);
    });

    it("returns empty results when no item ids are given", async () => {
      const result = await service.suggestVendors([], businessId);
      expect(result).toEqual({ perItem: [], recommended: [] });
    });
  });

  describe("quick send", () => {
    function boqItem(id: string, description: string, quantity: number, unit: string | null): BoqItemWithBreakdown {
      return { id, description, quantity, unit } as unknown as BoqItemWithBreakdown;
    }

    beforeEach(() => {
      vendorsRepository.vendors.set(vendorA, {
        id: vendorA,
        name: "Vendor A",
        contacts: [
          { name: "Raj Kumar", email: "raj@vendora.example", isPrimary: true },
          { name: "Backup Contact", email: "backup@vendora.example", isPrimary: false },
        ],
      });
    });

    describe("previewQuickSend", () => {
      it("generates preview text addressed to the vendor's primary contact", async () => {
        const item = boqItem(randomUUID(), "OPC Cement", 500, "bag");
        boqRepository.items.set(item.id, item);

        const preview = await service.previewQuickSend(
          { boqItemIds: [item.id], vendorId: vendorA },
          actorId,
          businessId,
        );

        expect(preview.vendorContactEmail).toBe("raj@vendora.example");
        expect(preview.text).toContain("Dear Raj Kumar,");
        expect(preview.text).toContain("1. OPC Cement — Qty: 500 bag");
        expect(preview.text).toContain("Priya PurchaseManager");
        expect(emailService.queueRfqEmail).not.toHaveBeenCalled();
      });

      it("includes the tender number when a tenderId is given", async () => {
        const item = boqItem(randomUUID(), "TMT Steel", 1200, "kg");
        boqRepository.items.set(item.id, item);
        const tenderId = randomUUID();
        tendersRepository.tenderIds.add(tenderId);
        tendersRepository.tenderNumbers.set(tenderId, "TND-0001");

        const preview = await service.previewQuickSend(
          { tenderId, boqItemIds: [item.id], vendorId: vendorA },
          actorId,
          businessId,
        );

        expect(preview.text).toContain("against tender TND-0001");
      });

      it("rejects when the vendor has no contact email on file", async () => {
        const item = boqItem(randomUUID(), "Item", 1, null);
        boqRepository.items.set(item.id, item);
        vendorsRepository.vendors.set(vendorB, { id: vendorB, name: "Vendor B", contacts: [] });

        await expect(
          service.previewQuickSend({ boqItemIds: [item.id], vendorId: vendorB }, actorId, businessId),
        ).rejects.toThrow(BadRequestError);
      });

      it("rejects when no items are selected", async () => {
        await expect(
          service.previewQuickSend({ boqItemIds: [], vendorId: vendorA }, actorId, businessId),
        ).rejects.toThrow(BadRequestError);
      });
    });

    describe("quickSend", () => {
      it("creates the RFQ, invites the vendor, and queues the email with the given text", async () => {
        const item = boqItem(randomUUID(), "OPC Cement", 500, "bag");
        boqRepository.items.set(item.id, item);

        const rfq = await service.quickSend(
          { boqItemIds: [item.id], vendorId: vendorA, text: "Custom edited body" },
          actorId,
          { businessId },
        );

        expect(rfq.status).toBe("SENT");
        expect(rfq.items).toHaveLength(1);
        expect(rfq.vendorInvites).toHaveLength(1);
        expect(rfq.vendorInvites[0]!.vendor.id).toBe(vendorA);
        expect(emailService.queueRfqEmail).toHaveBeenCalledWith({
          to: "raj@vendora.example",
          rfqTitle: rfq.title,
          bodyText: "Custom edited body",
        });
      });

      it("titles the RFQ using the tender number when a tenderId is given", async () => {
        const item = boqItem(randomUUID(), "Item", 1, null);
        boqRepository.items.set(item.id, item);
        const tenderId = randomUUID();
        tendersRepository.tenderIds.add(tenderId);
        tendersRepository.tenderNumbers.set(tenderId, "TND-0002");

        const rfq = await service.quickSend(
          { tenderId, boqItemIds: [item.id], vendorId: vendorA, text: "Body" },
          actorId,
          { businessId },
        );

        expect(rfq.title).toBe("TND-0002 — RFQ for Vendor A");
      });

      it("rejects when the vendor has no contact email on file", async () => {
        const item = boqItem(randomUUID(), "Item", 1, null);
        boqRepository.items.set(item.id, item);
        vendorsRepository.vendors.set(vendorB, { id: vendorB, name: "Vendor B", contacts: [] });

        await expect(
          service.quickSend({ boqItemIds: [item.id], vendorId: vendorB, text: "Body" }, actorId, {
            businessId,
          }),
        ).rejects.toThrow(BadRequestError);
        expect(emailService.queueRfqEmail).not.toHaveBeenCalled();
      });
    });
  });
});
