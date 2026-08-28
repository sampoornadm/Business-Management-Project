import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
// createApp() pulls in tenders.module.ts, which imports generateJson/generateText from this same
// module at eval time — ESM linking requires the mock to expose every name importers statically
// reference, even ones this test never calls, so they're stubbed alongside embedMock here.
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock, generateJson: vi.fn(), generateText: vi.fn() }));

import { createApp } from "../../../app.js";
import { s3Service } from "../../../infra/storage/s3.service.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

describe("GET /search — attachments (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let clientOrgId: string;
  let tenderId: string;
  let attachmentId: string;
  const storagePath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);

    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "Search Test Org", type: "GOVERNMENT", createdById: testUser.userId },
    });
    clientOrgId = client.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `SEARCH-IT-${Date.now()}`,
        title: "Cable Supply Tender",
        clientId: client.id,
        status: "DRAFT",
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;

    await s3Service.putObject({
      key: storagePath,
      body: Buffer.from("%PDF-1.4 placeholder"),
      contentType: "application/pdf",
    });
    const attachment = await prisma.attachment.create({
      data: {
        id: randomUUID(),
        originalName: "XLPE-cable-supply-notice.pdf",
        storedName: "test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        hash: randomUUID(),
        storageBucket: s3Service.bucket,
        storagePath,
        entityType: "Tender",
        entityId: tenderId,
        uploadedById: testUser.userId,
        documentType: "NIT",
      },
    });
    attachmentId = attachment.id;

    // This test covers the metadata (filename) half of search only — the fixture is a placeholder
    // buffer, not a real PDF, so there is nothing to embed. An empty embed() result makes
    // findContentMatches short-circuit before the ANN query, which is the honest no-op; do NOT
    // put a short placeholder vector here, it would blow up the ::vector(1024) cast.
    embedMock.mockResolvedValue([]);
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: attachmentId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    // Organization.createdById is onDelete: Restrict — must go before cleanupIntegrationTestUser
    // deletes the user, and after the tender (which references it via clientId) is gone.
    await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await s3Service.deleteObject(storagePath);
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("finds the attachment by a filename match", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ q: "XLPE-cable-supply-notice" })
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(200);
    expect(
      response.body.data.results.some((r: { type: string; id: string }) => r.type === "Attachment" && r.id === attachmentId),
    ).toBe(true);
  });
});
