import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findTenderByNumberAcrossBusinesses, listAllTendersForFolderSync } from "../docs-watcher.service.js";

/**
 * Requires a real Postgres reachable via .env.test, migrated (`pnpm db:migrate` against the test
 * database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 *
 * `docs-watcher.service.ts`'s local-folder sync (opt-in via `LOCAL_DOCS_SYNC_ENABLED`) used to run
 * two unscoped `Tender` queries — `reconcileFolders()`'s `findMany({ select: ... })` with no
 * `where` at all, and `importFile()`'s `findUnique({ where: { tenderNumber } })` — both refused at
 * query time by the businessId-scope guard (see scoped-client.ts's `SCOPED_MODELS`), crashing the
 * watcher outright the moment `LOCAL_DOCS_SYNC_ENABLED=true` was set. `Tender.tenderNumber` is
 * `@unique` at the top level of the schema (not compound with `businessId`), and local-docs folders
 * carry no business segment in their naming scheme, so both queries were rewritten to loop
 * `listAllBusinessIds()` and run scoped, per-business queries instead (see the doc comments on
 * `listAllTendersForFolderSync()`/`findTenderByNumberAcrossBusinesses()` in docs-watcher.service.ts).
 *
 * This exercises both functions against two real businesses through the same guarded Prisma client
 * the service uses in production — a regression back to a single unscoped query would throw via the
 * guard, not just return a wrong/incomplete result.
 */
describe("local docs sync tender lookups (integration)", () => {
  let userId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  let tenderAId: string;
  let tenderBId: string;
  let tenderANumber: string;
  let tenderBNumber: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `docs-watcher-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Docs",
        lastName: "Watcher",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const businessA = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business A ${randomUUID()}`,
        code: `DWA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business B ${randomUUID()}`,
        code: `DWB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;

    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Client ${randomUUID()}`,
        type: "PRIVATE",
        createdById: userId,
      },
    });
    organizationId = organization.id;

    tenderANumber = `TND-DOCS-A-${randomUUID().slice(0, 8)}`;
    tenderBNumber = `TND-DOCS-B-${randomUUID().slice(0, 8)}`;

    const tenderA = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: businessAId,
        tenderNumber: tenderANumber,
        title: "Docs watcher business A tender",
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
    tenderAId = tenderA.id;

    const tenderB = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: businessBId,
        tenderNumber: tenderBNumber,
        title: "Docs watcher business B tender",
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
    tenderBId = tenderB.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: { in: [tenderAId, tenderBId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("listAllTendersForFolderSync", () => {
    it("collects tenders from both businesses, not just one", async () => {
      const tenders = await listAllTendersForFolderSync();
      const tenderNumbers = tenders.map((tender) => tender.tenderNumber);

      expect(tenderNumbers).toContain(tenderANumber);
      expect(tenderNumbers).toContain(tenderBNumber);
    });
  });

  describe("findTenderByNumberAcrossBusinesses", () => {
    it("finds a tender that lives in business A", async () => {
      const tender = await findTenderByNumberAcrossBusinesses(tenderANumber);
      expect(tender?.id).toBe(tenderAId);
    });

    // Together with the assertion above, this proves the loop doesn't stop after only
    // checking whichever business happens to be first — regardless of the order
    // `listAllBusinessIds()` returns ids in, one of these two tenders is necessarily *not*
    // in the first-checked business, so a broken implementation that queried only the first
    // business (or otherwise failed to loop across all of them) would fail one of these two.
    it("finds a tender that lives in business B", async () => {
      const tender = await findTenderByNumberAcrossBusinesses(tenderBNumber);
      expect(tender?.id).toBe(tenderBId);
    });

    it("returns null when no business has a tender with that number", async () => {
      const tender = await findTenderByNumberAcrossBusinesses(`TND-DOES-NOT-EXIST-${randomUUID()}`);
      expect(tender).toBeNull();
    });
  });
});
