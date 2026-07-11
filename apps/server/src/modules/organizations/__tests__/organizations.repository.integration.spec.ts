import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { organizationsRepository } from "../organizations.module.js";

/**
 * Requires a real Postgres reachable via .env.test, migrated (`pnpm db:migrate` against the test
 * database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 *
 * `Organization` is intentionally global/shared across all businesses (unlike `Tender`, which is
 * business-scoped — see scoped-client.ts's `SCOPED_MODELS`), so one organization can legitimately
 * be referenced by tenders in multiple different businesses. `countTenders()` is a delete-guard
 * precondition and must therefore report a true cross-business total. This exercises it against
 * two real businesses through the same guarded Prisma client the repository uses in production —
 * a regression back to a single unscoped `tender.count({ where: { clientId } })` would throw via
 * the businessId-scope guard, not just return a wrong number.
 */
describe("OrganizationsRepository#countTenders (integration)", () => {
  let userId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  const tenderIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `org-count-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Org",
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
        code: `CBA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Count Business B ${randomUUID()}`,
        code: `CBB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;

    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Cross-business Client ${randomUUID()}`,
        type: "PRIVATE",
        createdById: userId,
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: { in: tenderIds } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function createTender(businessId: string): Promise<string> {
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `TND-COUNT-${randomUUID().slice(0, 8)}`,
        title: "Cross-business count test tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: userId,
      },
    });
    tenderIds.push(tender.id);
    return tender.id;
  }

  it("returns 0 when the organization has no tenders in any business", async () => {
    expect(await organizationsRepository.countTenders(organizationId)).toBe(0);
  });

  it("sums tenders referencing the organization across two different businesses", async () => {
    await createTender(businessAId);
    await createTender(businessAId);
    await createTender(businessBId);

    expect(await organizationsRepository.countTenders(organizationId)).toBe(3);
  });
});
