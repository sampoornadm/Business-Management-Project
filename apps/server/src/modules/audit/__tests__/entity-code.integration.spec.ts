import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEntityCodeResolver } from "../entity-code.js";

describe("createEntityCodeResolver (integration)", () => {
  const resolve = createEntityCodeResolver(prisma);
  let businessId: string;
  let userId: string;
  let clientId: string;
  let tenderId: string;
  let tenderNumber: string;
  let boqItemId: string;
  let itemId: string;

  beforeAll(async () => {
    businessId = (
      await prisma.business.create({ data: { id: randomUUID(), name: `EC ${randomUUID()}`, code: `EC${randomUUID().slice(0, 6)}` } })
    ).id;
    userId = (
      await prisma.user.create({
        data: { id: randomUUID(), email: `ec-${randomUUID()}@example.com`, firstName: "E", lastName: "C", passwordHash: "x", isEmailVerified: true },
      })
    ).id;
    clientId = (
      await prisma.organization.create({ data: { id: randomUUID(), name: `EC Client ${randomUUID()}`, type: "GOVERNMENT", createdById: userId } })
    ).id;
    tenderNumber = `EC-${randomUUID().slice(0, 8)}`;
    tenderId = (
      await prisma.tender.create({ data: { id: randomUUID(), businessId, tenderNumber, title: "EC", clientId, createdById: userId } })
    ).id;
    const boqId = randomUUID();
    await prisma.boq.create({ data: { id: boqId, businessId, tenderId, groupId: boqId, createdById: userId } });
    boqItemId = (await prisma.boqItem.create({ data: { id: randomUUID(), boqId, description: "Line" } })).id;
    itemId = (
      await prisma.item.create({ data: { id: randomUUID(), businessId, canonicalName: "ec item", itemCode: "73180042001" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { businessId } });
    await prisma.tender.deleteMany({ where: { businessId } });
    await prisma.organization.deleteMany({ where: { id: clientId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("Tender → its tender number", async () => {
    expect(await resolve("Tender", tenderId)).toBe(tenderNumber);
  });

  it("BoqItem → its tender's number", async () => {
    expect(await resolve("BoqItem", boqItemId)).toBe(tenderNumber);
  });

  it("Item → display-formatted item code", async () => {
    expect(await resolve("Item", itemId)).toBe("73 18 0042 001");
  });

  it("unknown type → null", async () => {
    expect(await resolve("Spaceship", tenderId)).toBeNull();
  });

  it("missing id → null", async () => {
    expect(await resolve("Tender", randomUUID())).toBeNull();
  });
});
