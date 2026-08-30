import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HistoricalRatesRepository } from "../rates.repository.js";

describe("HistoricalRatesRepository.recordFromRfqQuote (integration)", () => {
  let repository: HistoricalRatesRepository;
  let businessId: string;
  let userId: string;
  let vendorId: string;
  let rfqId: string;

  // recordFromRfqQuote's `rfqQuoteId` is a real FK to RfqQuote (unlike the plan brief's
  // assumption of a bare, unenforced UUID) — each call needs a genuine RfqQuote row, which in
  // turn needs an RfqItem and an Rfq to hang off of.
  async function createRfqQuote(): Promise<string> {
    const rfqItem = await prisma.rfqItem.create({
      data: { id: randomUUID(), rfqId, description: "OPC Cement", unit: "bag", quantity: 100 },
    });
    const quote = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId: rfqItem.id, vendorId, rate: 400 },
    });
    return quote.id;
  }

  beforeAll(async () => {
    repository = new HistoricalRatesRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Rates Repo Test ${randomUUID()}`, code: `RRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `rates-repo-test-${randomUUID()}@example.com`,
        firstName: "Rates",
        lastName: "Test",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
    const vendor = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Rates Test Vendor", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorId = vendor.id;
    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId, title: "Rates Repo Test RFQ", createdById: userId },
    });
    rfqId = rfq.id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { businessId } });
    if (rfqId) await prisma.rfq.deleteMany({ where: { id: rfqId } }); // cascades RfqItem + RfqQuote
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("marks the new row as default and clears any prior default for the same itemName", async () => {
    const first = await createRfqQuote();
    await repository.recordFromRfqQuote({
      businessId,
      itemName: "OPC Cement",
      unit: "bag",
      rate: 400,
      vendorId,
      rfqQuoteId: first,
      createdById: userId,
    });
    const second = await createRfqQuote();
    await repository.recordFromRfqQuote({
      businessId,
      itemName: "OPC Cement",
      unit: "bag",
      rate: 380,
      vendorId,
      rfqQuoteId: second,
      createdById: userId,
    });

    const rows = await prisma.historicalRate.findMany({ where: { businessId, itemName: "OPC Cement" } });
    expect(rows).toHaveLength(2);
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.rfqQuoteId).toBe(second);
  });
});
