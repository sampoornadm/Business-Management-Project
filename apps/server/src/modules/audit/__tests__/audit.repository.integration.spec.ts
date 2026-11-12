import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, describe, expect, it } from "vitest";

import { AuditRepository } from "../audit.repository.js";

describe("AuditRepository business visibility (integration)", () => {
  const repository = new AuditRepository(prisma);
  const action = `TEST_VISIBILITY_${randomUUID().slice(0, 8)}`;
  const businessA = randomUUID();
  const businessB = randomUUID();

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { action } });
    await prisma.$disconnect();
  });

  it("shows a business's own rows plus global rows, never another business's", async () => {
    await repository.create({ action, entityType: "Tender", entityId: "a", entityCode: "A-1", businessId: businessA });
    await repository.create({ action, entityType: "Tender", entityId: "b", entityCode: "B-1", businessId: businessB });
    await repository.create({ action, entityType: "Vendor", entityId: "v", entityCode: "Acme", businessId: null });

    const scoped = await repository.findMany({ page: 1, pageSize: 50 }, { action, visibleBusinessId: businessA });
    const all = await repository.findMany({ page: 1, pageSize: 50 }, { action });

    expect(scoped.items.map((r) => r.entityCode).sort()).toEqual(["A-1", "Acme"]);
    expect(scoped.totalItems).toBe(2);
    expect(all.totalItems).toBe(3);
  });
});
