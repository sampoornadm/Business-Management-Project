import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RfqRepository } from "../rfq.repository.js";

describe("RfqRepository (integration)", () => {
  let repository: RfqRepository;
  let businessId: string;
  let userId: string;
  let vendorAId: string;
  let vendorBId: string;
  let rfqId: string;
  let rfqItemId: string;
  let quoteAId: string;
  let quoteBId: string;

  beforeAll(async () => {
    repository = new RfqRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Rfq Repo Test ${randomUUID()}`, code: `RRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `rfq-repo-test-${randomUUID()}@example.com`,
        firstName: "Repo",
        lastName: "Test",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
    const vendorA = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Vendor A", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorAId = vendorA.id;
    const vendorB = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Vendor B", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorBId = vendorB.id;
    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId, title: "Test RFQ", createdById: userId },
    });
    rfqId = rfq.id;
    const item = await prisma.rfqItem.create({
      data: { id: randomUUID(), rfqId, description: "Cement", quantity: 100 },
    });
    rfqItemId = item.id;
    const quoteA = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId, vendorId: vendorAId, rate: 400 },
    });
    quoteAId = quoteA.id;
    const quoteB = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId, vendorId: vendorBId, rate: 380, isSelected: true },
    });
    quoteBId = quoteB.id;
  });

  afterAll(async () => {
    if (businessId) await prisma.rfq.deleteMany({ where: { businessId } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendorAId, vendorBId] } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("selecting a new quote unselects the previously-selected one for the same item", async () => {
    await repository.selectQuote(rfqItemId, quoteAId);

    const quoteA = await prisma.rfqQuote.findUniqueOrThrow({ where: { id: quoteAId } });
    const quoteB = await prisma.rfqQuote.findUniqueOrThrow({ where: { id: quoteBId } });
    expect(quoteA.isSelected).toBe(true);
    expect(quoteB.isSelected).toBe(false);
  });

  describe("update", () => {
    // Its own RFQ + item, separate from the outer suite's rfqId/rfqItemId — these tests mutate
    // and delete items, which would break the quote-selection test's fixture if shared.
    let updateRfqId: string;
    let keptItemId: string;
    let extraItemId: string;

    beforeAll(async () => {
      const rfq = await prisma.rfq.create({
        data: { id: randomUUID(), businessId, title: "Update Test RFQ", createdById: userId },
      });
      updateRfqId = rfq.id;
      const kept = await prisma.rfqItem.create({
        data: { id: randomUUID(), rfqId: updateRfqId, description: "Cement", quantity: 100, sortOrder: 0 },
      });
      keptItemId = kept.id;
      const extra = await prisma.rfqItem.create({
        data: { id: randomUUID(), rfqId: updateRfqId, description: "Sand", quantity: 50, sortOrder: 1 },
      });
      extraItemId = extra.id;
    });

    it("updates scalar fields without touching items", async () => {
      await repository.update(updateRfqId, { title: "Renamed RFQ" });

      const rfq = await prisma.rfq.findUniqueOrThrow({ where: { id: updateRfqId } });
      const items = await prisma.rfqItem.findMany({ where: { rfqId: updateRfqId } });
      expect(rfq.title).toBe("Renamed RFQ");
      expect(items).toHaveLength(2);
    });

    it("edits an existing item in place (same id) and creates a new one alongside it", async () => {
      await repository.update(updateRfqId, {
        items: [
          { id: keptItemId, description: "OPC Cement 53 grade", unit: "bag", quantity: 120, sortOrder: 0 },
          { description: "Gravel", unit: "ton", quantity: 20, sortOrder: 1 },
        ],
      });

      const items = await prisma.rfqItem.findMany({ where: { rfqId: updateRfqId }, orderBy: { sortOrder: "asc" } });
      // extraItemId ("Sand") is gone: left out of the payload above.
      expect(items.map((i) => i.description)).toEqual(["OPC Cement 53 grade", "Gravel"]);
      expect(items[0]!.id).toBe(keptItemId); // edited in place, not replaced
      expect(items[0]!.quantity).toBe(120);
      const newGravelId = items[1]!.id;
      expect(newGravelId).not.toBe(extraItemId);
    });

    it("wholesale-replaces items when every incoming line is new", async () => {
      await repository.update(updateRfqId, { items: [{ description: "Bricks", quantity: 1000 }] });

      const items = await prisma.rfqItem.findMany({ where: { rfqId: updateRfqId } });
      expect(items).toHaveLength(1);
      expect(items[0]!.description).toBe("Bricks");
    });
  });

  it("delete cascades to its items and quotes in Postgres", async () => {
    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId, title: "Delete Test RFQ", createdById: userId },
    });
    const item = await prisma.rfqItem.create({
      data: { id: randomUUID(), rfqId: rfq.id, description: "Item", quantity: 1 },
    });
    const quote = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId: item.id, vendorId: vendorAId, rate: 10 },
    });

    await repository.delete(rfq.id);

    expect(await prisma.rfq.findUnique({ where: { id: rfq.id } })).toBeNull();
    expect(await prisma.rfqItem.findUnique({ where: { id: item.id } })).toBeNull();
    expect(await prisma.rfqQuote.findUnique({ where: { id: quote.id } })).toBeNull();
  });
});
