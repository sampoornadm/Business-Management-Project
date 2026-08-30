import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { EmailService } from "../../../infra/mailer/email.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { BoqItemWithBreakdown, IBoqRepository } from "../../boq/boq.repository.js";
import type { IBusinessesRepository } from "../../businesses/businesses.repository.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type { IUsersRepository } from "../../users/users.repository.js";
import type { IVendorsRepository, VendorItemTypeMatch } from "../../vendors/vendors.repository.js";
import type {
  CreateRfqData,
  IRfqRepository,
  RfqDetail,
  RfqFilters,
  UpdateRfqData,
  UpsertQuoteData,
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
      instructions: data.instructions ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        rfqId: id,
        boqItemId: item.boqItemId ?? null,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        instructions: item.instructions ?? null,
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

  async findRfqByItemId(itemId: string, _businessId: string) {
    for (const rfq of this.rfqs.values()) {
      if (rfq.items.some((i) => i.id === itemId)) return rfq;
    }
    return null;
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

  async selectQuote(rfqItemId: string, quoteId: string) {
    for (const rfq of this.rfqs.values()) {
      const item = rfq.items.find((i) => i.id === rfqItemId);
      if (!item) continue;
      for (const quote of item.quotes as { id: string; isSelected: boolean }[]) {
        quote.isSelected = quote.id === quoteId;
      }
    }
  }

  async reopen(id: string, status: RfqDetail["status"]) {
    const rfq = this.rfqs.get(id);
    if (!rfq) throw new Error("not found");
    rfq.status = status;
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

  async upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData) {
    for (const rfq of this.rfqs.values()) {
      const item = rfq.items.find((i) => i.id === rfqItemId);
      if (!item) continue;
      const vendorName =
        rfq.vendorInvites.find((v) => v.vendor.id === vendorId)?.vendor.name ?? "Vendor";
      const existing = item.quotes.find((q) => q.vendorId === vendorId);
      if (existing) {
        Object.assign(existing, {
          rate: data.rate,
          regretted: data.regretted,
          remarks: data.remarks ?? null,
          ...(data.make !== undefined ? { make: data.make } : {}),
          ...(data.model !== undefined ? { model: data.model } : {}),
          ...(data.quotedAt !== undefined ? { quotedAt: data.quotedAt } : {}),
        });
      } else {
        (item.quotes as unknown[]).push({
          id: randomUUID(),
          rfqItemId,
          vendorId,
          vendor: { id: vendorId, name: vendorName },
          rate: data.rate,
          regretted: data.regretted,
          make: data.make ?? "Unbranded",
          model: data.model ?? "Generic",
          quotedAt: data.quotedAt ?? new Date(),
          remarks: data.remarks ?? null,
          updatedAt: new Date(),
          isSelected: false,
        });
      }
    }
  }

  // Real filtering/scoping is Postgres — covered by the integration test.
  async listItemPrices() {
    return { items: [] as never[], totalItems: 0 };
  }

  async findBoqItemCategories() {
    return [];
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

class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  businesses = new Map<string, { name: string; address: string | null; gstNumber: string | null }>();

  async findById(id: string) {
    return (this.businesses.get(id) ?? null) as never;
  }
}

describe("RfqService", () => {
  let repository: FakeRfqRepository;
  let tendersRepository: FakeTendersRepository;
  let vendorsRepository: FakeVendorsRepository;
  let boqRepository: FakeBoqRepository;
  let usersRepository: FakeUsersRepository;
  let businessesRepository: FakeBusinessesRepository;
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
    businessesRepository = new FakeBusinessesRepository();
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
      businessesRepository as unknown as IBusinessesRepository,
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

  it("records a regret with no rate, and defaults make/model when the vendor gave none", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);

    await service.upsertQuote(itemId, vendorA, { regretted: true }, actorId, businessId);

    const saved = repository.rfqs.get(rfq.id)!.items[0]!.quotes.find((q) => q.vendorId === vendorA)!;
    expect(saved.rate).toBeNull();
    expect(saved.regretted).toBe(true);
    expect(saved.make).toBe("Unbranded");
    expect(saved.model).toBe("Generic");
  });

  it("rejects a quote that is neither priced nor a regret", async () => {
    const rfq = await createBasicRfq();
    const itemId = rfq.items[0]!.id;
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);

    await expect(
      service.upsertQuote(itemId, vendorA, {}, actorId, businessId),
    ).rejects.toThrow(BadRequestError);
  });

  // Builds an RFQ with a single item and seeds its quotes directly on the fake
  // repository — there's no public API yet to record a regret (that's a
  // separate task), so the row is constructed the same way the repository
  // itself would shape it from Prisma.
  async function seedRfqWithQuotes(
    quotes: Array<{ vendorId: string; vendorName: string; rate: number | null; regretted: boolean }>,
  ) {
    const rfq = await createBasicRfq();
    const rawRfq = repository.rfqs.get(rfq.id)!;
    const item = rawRfq.items[0]!;
    item.quotes = quotes.map((q) => ({
      id: randomUUID(),
      rfqItemId: item.id,
      vendorId: q.vendorId,
      vendor: { id: q.vendorId, name: q.vendorName },
      rate: q.rate,
      regretted: q.regretted,
      make: "Unbranded",
      model: "Generic",
      quotedAt: new Date(),
      remarks: null,
      updatedAt: new Date(),
    })) as unknown as typeof item.quotes;
    return rfq.id;
  }

  it("excludes a regretted quote from the lowest rate, totals and itemsQuoted", async () => {
    // Vendor A quotes 100. Vendor B regretted this line. B must not win it at 0.
    const rfqId = await seedRfqWithQuotes([
      { vendorId: vendorA, vendorName: "A", rate: 100, regretted: false },
      { vendorId: vendorB, vendorName: "B", rate: null, regretted: true },
    ]);

    const comparison = await service.getComparison(rfqId, businessId);

    const line = comparison.items[0]!;
    const a = line.quotes.find((q) => q.vendorId === vendorA)!;
    const b = line.quotes.find((q) => q.vendorId === vendorB)!;

    expect(a.isLowest).toBe(true);
    expect(b.isLowest).toBe(false);
    expect(b.rate).toBeNull();
    expect(b.amount).toBeNull();

    const totalB = comparison.vendorTotals.find((v) => v.vendorId === vendorB)!;
    expect(totalB.total).toBe(0);
    expect(totalB.itemsQuoted).toBe(0);
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

  it("selects a specific quote for an item, unselecting any prior selection", async () => {
    const rfq = await createBasicRfq();
    await repository.addVendorInvite(rfq.id, vendorA);
    await repository.addVendorInvite(rfq.id, vendorB);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);
    await service.upsertQuote(itemId, vendorB, { rate: 380, regretted: false }, actorId, businessId);

    // vendorA was the only quote on the item when it arrived, so auto-select-lowest
    // picked it. vendorB's later, cheaper quote does not silently steal the
    // selection — that's the whole point of the "only when nothing is selected
    // yet" guard, exercised more directly by the next test.
    let current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!.isSelected).toBe(false);

    // repository fake keys quotes by vendorId, not a separate id — selectQuote takes the
    // quote's own id, which the fake generates; fetch it via the raw map.
    const rawItem = repository.rfqs.get(rfq.id)!.items[0]!;
    const rawQuoteB = (rawItem.quotes as { id: string; vendorId: string }[]).find((q) => q.vendorId === vendorB)!;

    // An explicit selectQuote call moves the selection regardless — including away
    // from whichever quote got there first via auto-select.
    await service.selectQuote(rfq.id, itemId, rawQuoteB.id, actorId, businessId);

    current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(false);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!.isSelected).toBe(true);
  });

  it("does not override an explicit selection when a cheaper quote arrives later", async () => {
    const rfq = await createBasicRfq();
    await repository.addVendorInvite(rfq.id, vendorA);
    await repository.addVendorInvite(rfq.id, vendorB);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);
    // Only one quote exists — vendorA gets auto-selected.
    let current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);

    // A cheaper quote arrives — must NOT silently steal the selection.
    await service.upsertQuote(itemId, vendorB, { rate: 350, regretted: false }, actorId, businessId);
    current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!.isSelected).toBe(false);
  });

  it("rejects selecting a quote id that doesn't belong to the given item", async () => {
    const rfq = await createBasicRfq();
    await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);

    await expect(
      service.selectQuote(rfq.id, itemId, randomUUID(), actorId, businessId),
    ).rejects.toThrow(BadRequestError);
  });

  it("closes an RFQ", async () => {
    const rfq = await createBasicRfq();
    const closed = await service.close(rfq.id, actorId, businessId);
    expect(closed.status).toBe("CLOSED");
  });

  it("throws for an unknown RFQ id", async () => {
    await expect(service.getById(randomUUID(), businessId)).rejects.toThrow(NotFoundError);
  });

  it("builds a PDF request-for-rates document for an existing RFQ", async () => {
    businessesRepository.businesses.set(businessId, { name: "Archie Udyog", address: null, gstNumber: null });
    const rfq = await createBasicRfq();

    const { filename, buffer } = await service.buildRfrPdfFor(rfq.id, businessId);

    expect(filename).toMatch(/\.pdf$/);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("throws NotFoundError when the business record is missing", async () => {
    const rfq = await createBasicRfq();

    await expect(service.buildRfrPdfFor(rfq.id, businessId)).rejects.toThrow(NotFoundError);
  });

  describe("reopen", () => {
    it("reopens a CLOSED RFQ back to SENT", async () => {
      const rfq = await createBasicRfq();
      await repository.addVendorInvite(rfq.id, vendorA);
      await service.close(rfq.id, actorId, businessId);
      const reopened = await service.reopen(rfq.id, actorId, { businessId });
      expect(reopened.status).toBe("SENT");
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

  describe("invite vendor", () => {
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

    describe("previewInviteVendor", () => {
      it("generates preview text for the vendor's primary contact", async () => {
        const rfq = await createBasicRfq();

        const preview = await service.previewInviteVendor(rfq.id, { vendorId: vendorA }, businessId);

        expect(preview.vendorContactEmail).toBe("raj@vendora.example");
        expect(preview.text).toContain(`RFQ "${rfq.title}"`);
        expect(preview.text).not.toContain("(tender-linked)");
      });

      it("flags the preview as tender-linked when the RFQ has a tenderId", async () => {
        const tenderId = randomUUID();
        tendersRepository.tenderIds.add(tenderId);
        const rfq = await service.create(
          { title: "Steel RFQ", tenderId, items: [{ description: "TMT Steel", quantity: 1200 }] },
          actorId,
          { businessId },
        );

        const preview = await service.previewInviteVendor(rfq.id, { vendorId: vendorA }, businessId);

        expect(preview.text).toContain("(tender-linked)");
      });

      it("rejects when the vendor has no contact email on file", async () => {
        const rfq = await createBasicRfq();
        vendorsRepository.vendors.set(vendorB, { id: vendorB, name: "Vendor B", contacts: [] });

        await expect(
          service.previewInviteVendor(rfq.id, { vendorId: vendorB }, businessId),
        ).rejects.toThrow(BadRequestError);
      });
    });

    describe("inviteVendor", () => {
      it("invites the vendor to the existing RFQ and emails them", async () => {
        const rfq = await createBasicRfq();
        const invited = await service.inviteVendor(
          rfq.id,
          { vendorId: vendorA, text: "Please quote" },
          actorId,
          { businessId },
        );
        expect(invited.vendorInvites).toHaveLength(1);
        expect(invited.vendorInvites[0]!.vendor.id).toBe(vendorA);
        expect(invited.status).toBe("SENT");
        expect(emailService.queueRfqEmail).toHaveBeenCalledWith(
          expect.objectContaining({ bodyText: "Please quote" }),
        );
      });

      it("does not duplicate the invite or reset status when the vendor is already invited", async () => {
        const rfq = await createBasicRfq();
        await service.addVendorInvite(rfq.id, vendorA, actorId, businessId);

        const invited = await service.inviteVendor(
          rfq.id,
          { vendorId: vendorA, text: "Second message" },
          actorId,
          { businessId },
        );

        expect(invited.vendorInvites).toHaveLength(1);
        expect(emailService.queueRfqEmail).toHaveBeenCalledWith(
          expect.objectContaining({ bodyText: "Second message" }),
        );
      });

      it("rejects a vendor with no contact email on file", async () => {
        const rfq = await createBasicRfq();
        vendorsRepository.vendors.set(vendorA, { id: vendorA, name: "No Email Co", contacts: [] });
        await expect(
          service.inviteVendor(rfq.id, { vendorId: vendorA, text: "Body" }, actorId, { businessId }),
        ).rejects.toThrow(BadRequestError);
      });
    });
  });
});
