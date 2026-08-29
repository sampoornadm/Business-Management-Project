import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ExtractTextFn, GenerateJsonFn } from "../../tender-extraction.service.js";
import { TenderExtractionService } from "../../tender-extraction.service.js";
import { organizationsRepository } from "../../../organizations/organizations.module.js";
import { processIncomingTenderFile } from "../incoming-tenders.service.js";

// Real text shape from the actual `pdftotext` CLI's output for the SAIL/IISCO
// template (see tender-header.parser.ts's own doc comment) — enough for
// parseIiscoHeaderFields to recognize it and extract deterministically, no
// LLM/Ollama needed. Parameterized by tenderNumber/clientName so each test case
// gets its own unique values — tenderNumber is a real @unique DB column and this
// file's tests share one Postgres, so two tests using the same literal number
// would collide (the whole point of the "duplicate" test below is to prove a
// collision is handled — it must not happen by accident between unrelated tests
// too).
function buildSailFixtureText(tenderNumber: string, clientName: string): string {
  return `BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

${tenderNumber}
MJ/C04/2026/3699-SLEEVE

TE Date:
13.07.2026
Amendment No:

Contracting Agency:
Amendment Date:

${clientName}
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

07.07.2026 15:00:00 Hrs

RFQ Item Details
RFQ Description :
Procurement of sleeves

Sl No

Item Code

Qty

UoM

1
71301005600045
250.000
M
Material Long Description TUBE MATERIAL: POLYURETHANE
Item Additional
Description:`;
  // The item table above is enough for parseIiscoRfqItems (a separate function
  // from the header parser, scanning this same full text for its own anchor)
  // to produce one real item. Without it, result.items would be empty and
  // boqService.commitBoq would never be called, so Test 1 below wouldn't
  // actually exercise the BOQ-commit path.
}

const NO_TENDER_NUMBER_TEXT = "This document has no recognizable tender fields at all.";
const CLIENT_NAME_PREFIX = "Incoming Tenders Test Client";

const fakeGenerateJson: GenerateJsonFn = async () => ({});

describe("incoming-tenders ingestion (integration)", () => {
  let rootDir: string;
  let businessId: string;
  let businessCode: string;
  let userId: string;

  beforeAll(async () => {
    businessCode = `INGEST${randomUUID().slice(0, 6)}`;
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Ingestion Test Business ${randomUUID()}`, code: businessCode },
    });
    businessId = business.id;

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `incoming-tenders-test-${randomUUID()}@example.com`,
        firstName: "Local Folder",
        lastName: "Sync",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Guarded on the id being set: if beforeAll throws partway through (leaving
    // businessId/userId undefined), an unguarded `deleteMany({ where: { id: undefined } })`
    // would have Prisma treat the filter as absent and wipe the *entire* table instead of
    // no-oping — exactly what happened to this test DB's `users` table while writing this
    // test (a hardcoded, already-seeded email collided in beforeAll, then this cleanup ran
    // unguarded and deleted every user, seed data included).
    if (businessId) await prisma.tender.deleteMany({ where: { businessId } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: CLIENT_NAME_PREFIX } } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "incoming-tenders-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function fakeExtractionService(text: string): TenderExtractionService {
    const fakeExtractText: ExtractTextFn = async () => text;
    return new TenderExtractionService(organizationsRepository, fakeGenerateJson, fakeExtractText);
  }

  it("creates a DRAFT tender, client org, and BOQ from a recognized document", async () => {
    const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
    const clientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });
    const filePath = path.join(incomingDir, "BID-fixture.PDF");
    await writeFile(filePath, "fake pdf bytes — extractText is faked, content here is irrelevant");

    await processIncomingTenderFile(
      rootDir,
      filePath,
      fakeExtractionService(buildSailFixtureText(tenderNumber, clientName)),
    );

    const tender = await prisma.tender.findFirst({ where: { businessId, tenderNumber } });
    expect(tender).not.toBeNull();
    expect(tender?.status).toBe("DRAFT");
    expect(tender?.remarks).toContain("Left blank — not stated in the source document");

    const organization = await prisma.organization.findFirst({ where: { name: clientName } });
    expect(organization).not.toBeNull();

    const boq = await prisma.boq.findFirst({ where: { tenderId: tender!.id }, include: { items: true } });
    expect(boq).not.toBeNull();
    expect(boq!.items.length).toBeGreaterThan(0);

    // Source file moved into the tender's NIT folder, not left in incoming-tenders/.
    const remainingIncoming = await readdir(incomingDir);
    expect(remainingIncoming).toEqual([]);
  });

  it("leaves the file in place when no tenderNumber/submissionDate can be extracted", async () => {
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });
    const filePath = path.join(incomingDir, "unrecognized.pdf");
    await writeFile(filePath, "fake pdf bytes");

    await processIncomingTenderFile(rootDir, filePath, fakeExtractionService(NO_TENDER_NUMBER_TEXT));

    const remaining = await readdir(incomingDir);
    expect(remaining).toEqual(["unrecognized.pdf"]);
  });

  it("moves the file to duplicates/ when the tenderNumber already exists", async () => {
    const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
    const preExistingClientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });

    const organization = await prisma.organization.create({
      data: { id: randomUUID(), name: preExistingClientName, type: "GOVERNMENT", createdById: userId },
    });
    await prisma.tender.create({
      data: {
        id: randomUUID(),
        tenderNumber,
        title: "Already exists",
        department: "Dept",
        clientId: organization.id,
        type: "Open",
        category: "General",
        location: "Somewhere",
        state: "Somewhere",
        estimatedCost: 0,
        submissionDate: new Date(),
        businessId,
        createdById: userId,
      },
    });

    const newClientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const filePath = path.join(incomingDir, "BID-fixture.PDF");
    await writeFile(filePath, "fake pdf bytes");

    await processIncomingTenderFile(
      rootDir,
      filePath,
      fakeExtractionService(buildSailFixtureText(tenderNumber, newClientName)),
    );

    const duplicatesDir = path.join(incomingDir, "duplicates");
    const duplicateFiles = await readdir(duplicatesDir);
    expect(duplicateFiles).toEqual(["BID-fixture.PDF"]);
    const remainingIncoming = (await readdir(incomingDir)).filter((name) => name !== "duplicates");
    expect(remainingIncoming).toEqual([]);
  });

  it("does not create an orphan Organization when the tenderNumber already exists", async () => {
    const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
    const preExistingClientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });

    const organization = await prisma.organization.create({
      data: { id: randomUUID(), name: preExistingClientName, type: "GOVERNMENT", createdById: userId },
    });
    await prisma.tender.create({
      data: {
        id: randomUUID(),
        tenderNumber,
        title: "Already exists",
        department: "Dept",
        clientId: organization.id,
        type: "Open",
        category: "General",
        location: "Somewhere",
        state: "Somewhere",
        estimatedCost: 0,
        submissionDate: new Date(),
        businessId,
        createdById: userId,
      },
    });

    // A brand-new client name that doesn't match any existing organization — before
    // Finding 1's fix, resolving/creating this org happened BEFORE the duplicate-
    // tenderNumber check, so this exact scenario left an orphan Organization row
    // behind even though the tender creation was always going to be rejected.
    const newClientName = `${CLIENT_NAME_PREFIX} orphan-check ${randomUUID().slice(0, 8)}`;
    const filePath = path.join(incomingDir, "BID-fixture.PDF");
    await writeFile(filePath, "fake pdf bytes");

    const orgCountBefore = await prisma.organization.count({ where: { name: newClientName } });

    await processIncomingTenderFile(
      rootDir,
      filePath,
      fakeExtractionService(buildSailFixtureText(tenderNumber, newClientName)),
    );

    const orgCountAfter = await prisma.organization.count({ where: { name: newClientName } });
    expect(orgCountAfter).toBe(orgCountBefore);
    expect(orgCountAfter).toBe(0);

    const duplicatesDir = path.join(incomingDir, "duplicates");
    const duplicateFiles = await readdir(duplicatesDir);
    expect(duplicateFiles).toEqual(["BID-fixture.PDF"]);
  });
});
