import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import PizZip from "pizzip";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { env } from "../../../config/env.js";
import { createIntegrationTestUser, cleanupIntegrationTestUser, type IntegrationTestUser } from "../../../shared/test-utils/integration-auth.js";

function buildTestDocxBuffer(bodyText: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body>` +
      "</w:document>",
  );
  return zip.generate({ type: "nodebuffer" });
}

/**
 * Requires a real Postgres + Redis reachable via .env.test, with migrations applied.
 * Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("POST /tenders/:id/documents/undertaking (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let tenderId: string;
  let clientOrgId: string;
  let templatesDir: string;
  // `env` (from config/env.ts) is parsed from process.env once at module-import
  // time and cached as a plain object — by the time this file's `beforeAll`
  // runs, app.js's import graph has already resolved `env.TEMPLATES_ROOT_DIR`,
  // so setting process.env here would have no effect. Mutate the already-
  // parsed `env` object directly instead (same technique the sibling unit
  // test in document-generation.service.spec.ts uses).
  const originalTemplatesRootDir = env.TEMPLATES_ROOT_DIR;

  beforeAll(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-integration-"));
    env.TEMPLATES_ROOT_DIR = templatesDir;
  });

  afterAll(async () => {
    await rm(templatesDir, { recursive: true, force: true });
    env.TEMPLATES_ROOT_DIR = originalTemplatesRootDir;
  });

  beforeEach(async () => {
    testUser = await createIntegrationTestUser(app);
    const clientOrg = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: "Integration Client Org",
        type: "GOVERNMENT",
        createdById: testUser.userId,
      },
    });
    clientOrgId = clientOrg.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `TEN-${randomUUID().slice(0, 8)}`,
        title: "Integration Test Tender",
        department: "Test Dept",
        clientId: clientOrgId,
        type: "OPEN",
        category: "CIVIL",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: new Date(),
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
  });

  afterEach(async () => {
    // templatesDir is shared across every test in this suite (created once in
    // beforeAll); reset it here so a test that wrote a template doesn't leak
    // it into a later test that assumes the template is absent.
    await rm(path.join(templatesDir, "undertaking.docx"), { force: true });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await cleanupIntegrationTestUser(testUser);
  });

  it("generates a filled docx when the template exists", async () => {
    await mkdir(templatesDir, { recursive: true });
    await writeFile(
      path.join(templatesDir, "undertaking.docx"),
      buildTestDocxBuffer("Tender {{tenderNumber}} for {{clientOrganizationName}}."),
    );

    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/documents/undertaking`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      // supertest always buffers (superagent's `_buffer` ends up `true`, never
      // `undefined`), which short-circuits superagent's content-type sniffing
      // straight to its text parser for a mime type it doesn't recognize.
      // `.responseType("blob")` forces the generic binary Buffer parser so
      // `response.body` is a real Buffer instead of `res.text` string data.
      .responseType("blob");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const resultZip = new PizZip(response.body as Buffer);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Integration Client Org");
  });

  it("returns 404 with a clear message when the template file is missing", async () => {
    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/documents/undertaking`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/template not found/i);
  });

  it("returns 404 for a tender that belongs to a different business than the caller's active one", async () => {
    const otherBusinessTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.secondBusinessId,
        tenderNumber: `TEN-OTHER-${randomUUID().slice(0, 8)}`,
        title: "Other Business Tender",
        department: "Test Dept",
        clientId: clientOrgId,
        type: "OPEN",
        category: "CIVIL",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: new Date(),
        createdById: testUser.userId,
      },
    });

    try {
      const response = await request(app)
        .post(`/api/v1/tenders/${otherBusinessTender.id}/documents/undertaking`)
        .set("Authorization", `Bearer ${testUser.accessToken}`);

      expect(response.status).toBe(404);
    } finally {
      await prisma.tender.deleteMany({ where: { id: otherBusinessTender.id } });
    }
  });
});
