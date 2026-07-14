import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import type { FSWatcher } from "chokidar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { listAllTendersForFolderSync, startLocalDocsWatcher } from "../docs-watcher.service.js";
import { tenderFolderName } from "../folder-naming.js";

/**
 * Requires a real Postgres reachable via .env.test, migrated (`pnpm db:migrate` against the test
 * database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 *
 * `docs-watcher.service.ts`'s local-folder sync (opt-in via `LOCAL_DOCS_SYNC_ENABLED`) used to run
 * an unscoped `Tender` query — `reconcileFolders()`'s `findMany({ select: ... })` with no `where`
 * at all — refused at query time by the businessId-scope guard (see scoped-client.ts's
 * `SCOPED_MODELS`), crashing the watcher outright the moment `LOCAL_DOCS_SYNC_ENABLED=true` was
 * set. It was rewritten to loop `listAllBusinessIds()` and run a scoped, per-business query per
 * business instead (see `listAllTendersForFolderSync()`'s doc comment in docs-watcher.service.ts).
 * `importFile()` now resolves a dropped file's business directly from its path's business-code
 * segment (see the `importFile` describe block below), so it no longer needs a cross-business
 * search at all.
 *
 * This exercises `listAllTendersForFolderSync` against two real businesses through the same
 * guarded Prisma client the service uses in production — a regression back to a single unscoped
 * query would throw via the guard, not just return a wrong/incomplete result.
 */
describe("local docs sync tender lookups (integration)", () => {
  let userId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  let businessACode: string;
  let businessBCode: string;
  let tenderAId: string;
  let tenderBId: string;
  let tenderANumber: string;
  let tenderBNumber: string;
  let tenderAFolderName: string;
  let tenderBFolderName: string;

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
    businessACode = businessA.code;
    businessBCode = businessB.code;

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
    tenderAFolderName = tenderFolderName(tenderA);

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
    tenderBFolderName = tenderFolderName(tenderB);
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: { in: [tenderAId, tenderBId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("listAllTendersForFolderSync", () => {
    it("collects tenders from both businesses, not just one, each tagged with its business code", async () => {
      const tenders = await listAllTendersForFolderSync();
      const tenderA = tenders.find((tender) => tender.tenderNumber === tenderANumber);
      const tenderB = tenders.find((tender) => tender.tenderNumber === tenderBNumber);

      expect(tenderA?.businessCode).toBe(businessACode);
      expect(tenderB?.businessCode).toBe(businessBCode);
    });
  });

  /**
   * `importFile` (private to docs-watcher.service.ts) is exercised here through the public
   * `startLocalDocsWatcher` API — a real chokidar watcher on a real temp directory, real files
   * written to disk, real `add` events firing `importFile` end-to-end. This is the only coverage
   * of importFile's `<businessCode>/tenders/<tenderFolder>/<filename>` path parsing and its two
   * "no match, skip and log (don't throw)" branches (unresolvable business code, unresolvable
   * tender folder within a resolved business) — the test above only covers
   * `listAllTendersForFolderSync`, which importFile doesn't call directly (it queries
   * `business`/`tender` via Prisma itself once it has the path's business-code segment).
   *
   * `awaitWriteFinish` (stabilityThreshold: 1500ms, pollInterval: 200ms) means an `add` event never
   * fires the instant a file is written — assertions poll via `vi.waitFor` instead of a fixed
   * `setTimeout`. For the two negative cases, a "control" file dropped into a known-good path in the
   * same test is used as the timing signal: once the control file's Attachment shows up, the
   * watcher has necessarily also had its chance to process the bad file, so asserting "no Attachment"
   * at that point isn't a guess about how long is "long enough".
   */
  describe("importFile via startLocalDocsWatcher (integration)", () => {
    let rootDir: string;
    let watcher: FSWatcher | undefined;

    beforeEach(async () => {
      rootDir = await mkdtemp(path.join(os.tmpdir(), "docs-watcher-"));
    });

    afterEach(async () => {
      await watcher?.close();
      watcher = undefined;
      await rm(rootDir, { recursive: true, force: true });
      await prisma.attachment.deleteMany({ where: { entityId: { in: [tenderAId, tenderBId] } } });
    });

    async function dropFile(relativePath: string, content: string): Promise<void> {
      const filePath = path.join(rootDir, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    async function waitForAttachment(originalName: string) {
      return vi.waitFor(
        async () => {
          const found = await prisma.attachment.findFirst({ where: { originalName, entityType: "Tender" } });
          expect(found).not.toBeNull();
          return found!;
        },
        { timeout: 8000, interval: 250 },
      );
    }

    it("imports dropped files as Attachments on the tender resolved from each file's own business+folder path", async () => {
      watcher = await startLocalDocsWatcher(rootDir);
      await dropFile(path.join(businessACode, "tenders", tenderAFolderName, "happy-a.txt"), "business A file");
      await dropFile(path.join(businessBCode, "tenders", tenderBFolderName, "happy-b.txt"), "business B file");

      const attachmentA = await waitForAttachment("happy-a.txt");
      const attachmentB = await waitForAttachment("happy-b.txt");

      expect(attachmentA.entityId).toBe(tenderAId);
      expect(attachmentA.entityId).not.toBe(tenderBId);
      expect(attachmentB.entityId).toBe(tenderBId);
      expect(attachmentB.entityId).not.toBe(tenderAId);
    });

    it("skips a file whose business code segment matches no Business (no Attachment created)", async () => {
      watcher = await startLocalDocsWatcher(rootDir);
      await dropFile(
        path.join("NONEXISTENT-CODE", "tenders", tenderAFolderName, "bad-business.txt"),
        "should never be imported",
      );
      // Control file in a known-good path — see describe-level comment on why this is the
      // wait signal instead of a fixed sleep.
      await dropFile(path.join(businessACode, "tenders", tenderAFolderName, "control.txt"), "control content");
      await waitForAttachment("control.txt");

      const badAttachment = await prisma.attachment.findFirst({ where: { originalName: "bad-business.txt" } });
      expect(badAttachment).toBeNull();
    });

    it("skips a file whose tender folder doesn't match any tender within that business (no Attachment created)", async () => {
      watcher = await startLocalDocsWatcher(rootDir);
      await dropFile(
        path.join(businessACode, "tenders", "UNKNOWN-999 - Ghost Tender", "bad-tender.txt"),
        "should never be imported",
      );
      await dropFile(path.join(businessACode, "tenders", tenderAFolderName, "control.txt"), "control content");
      await waitForAttachment("control.txt");

      const badAttachment = await prisma.attachment.findFirst({ where: { originalName: "bad-tender.txt" } });
      expect(badAttachment).toBeNull();
    });

    // Regression guard for the actual bug shape a business-scope bypass would take: unlike the two
    // negative cases above (a business code that matches nothing, a tender folder that matches
    // nothing), here BOTH segments individually resolve — just to different businesses. Business A's
    // real code + business B's real tender folder name. `Tender.tenderNumber` is globally `@unique`,
    // so a broken `importFile` that dropped the `businessId: business.id` filter (falling back to an
    // unscoped `findFirst({ where: { tenderNumber } })`) would still "successfully" resolve tender B
    // here — the three pre-existing tests can't tell scoped-lookup apart from that regression because
    // in each of them the scoped and unscoped queries return the same tender. This is the one case
    // where they diverge: correctly-scoped code finds no tender under business A and skips; the
    // regression finds tender B and wrongly attaches to it.
    it("skips a file whose business code is A but whose tender folder belongs to business B's tender (no cross-business Attachment on either tender)", async () => {
      watcher = await startLocalDocsWatcher(rootDir);
      await dropFile(
        path.join(businessACode, "tenders", tenderBFolderName, "cross-business.txt"),
        "should never be imported",
      );
      await dropFile(path.join(businessACode, "tenders", tenderAFolderName, "control.txt"), "control content");
      await waitForAttachment("control.txt");

      const badAttachment = await prisma.attachment.findFirst({ where: { originalName: "cross-business.txt" } });
      expect(badAttachment).toBeNull();
    });
  });
});
