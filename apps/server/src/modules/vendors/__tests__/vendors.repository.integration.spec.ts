import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { vendorsRepository } from "../vendors.module.js";

/**
 * Requires a real Postgres reachable via .env.test, migrated (`pnpm db:migrate` against the test
 * database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 *
 * `Vendor` is intentionally global/shared across all businesses (unlike `PurchaseOrder`, which is
 * business-scoped — see scoped-client.ts's `SCOPED_MODELS`), so one vendor can legitimately be
 * referenced by purchase orders in multiple different businesses. `countPurchaseOrders()` is a
 * delete-guard precondition and must therefore report a true cross-business total. This exercises
 * it against two real businesses through the same guarded Prisma client the repository uses in
 * production — a regression back to a single unscoped `purchaseOrder.count({ where: { vendorId } })`
 * would throw via the businessId-scope guard, not just return a wrong number.
 */
describe("VendorsRepository#countPurchaseOrders (integration)", () => {
  let userId: string;
  let vendorId: string;
  let businessAId: string;
  let businessBId: string;
  const purchaseOrderIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `vendor-count-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Vendor",
        lastName: "Counter",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const businessA = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Count Business A ${randomUUID()}`,
        code: `VCA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Count Business B ${randomUUID()}`,
        code: `VCB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;

    const vendor = await prisma.vendor.create({
      data: {
        id: randomUUID(),
        name: `Cross-business Vendor ${randomUUID()}`,
        category: "MATERIAL_SUPPLIER",
        createdById: userId,
      },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function createPurchaseOrder(businessId: string): Promise<string> {
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        id: randomUUID(),
        businessId,
        poNumber: `PO-COUNT-${randomUUID().slice(0, 8)}`,
        vendorId,
        createdById: userId,
      },
    });
    purchaseOrderIds.push(purchaseOrder.id);
    return purchaseOrder.id;
  }

  it("returns 0 when the vendor has no purchase orders in any business", async () => {
    expect(await vendorsRepository.countPurchaseOrders(vendorId)).toBe(0);
  });

  it("sums purchase orders referencing the vendor across two different businesses", async () => {
    await createPurchaseOrder(businessAId);
    await createPurchaseOrder(businessAId);
    await createPurchaseOrder(businessBId);

    expect(await vendorsRepository.countPurchaseOrders(vendorId)).toBe(3);
  });
});
