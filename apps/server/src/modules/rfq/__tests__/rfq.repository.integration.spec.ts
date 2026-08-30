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
});
