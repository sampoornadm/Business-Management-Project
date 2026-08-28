import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ReportsRepository } from "../reports.repository.js";

describe("findNearestAttachments (integration)", () => {
  const repository = new ReportsRepository(prisma);
  let businessId: string;
  let userId: string;
  let organizationId: string;
  let tenderId: string;
  const attachmentIds: string[] = [];

  async function insertEmbeddedAttachment(originalName: string, vector: number[]): Promise<string> {
    const id = randomUUID();
    await prisma.attachment.create({
      data: {
        id,
        originalName,
        storedName: originalName,
        mimeType: "application/pdf",
        sizeBytes: 10,
        hash: randomUUID(),
        storageBucket: "test-bucket",
        storagePath: `tender/${tenderId}/${id}-original.pdf`,
        entityType: "Tender",
        entityId: tenderId,
        uploadedById: userId,
        embedding: vector,
        embeddedAt: new Date(),
      },
    });
    const vectorLiteral = `[${vector.join(",")}]`;
    await prisma.$executeRaw`UPDATE attachments SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
    attachmentIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "ANN Attachment Test Business", code: `ANNA${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `ann-attachment-${randomUUID()}@example.com`,
        passwordHash: "not-a-real-hash",
        firstName: "Ann",
        lastName: "Tester",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
    // Organization has no businessId column (unlike Tender) — it's scoped by createdById instead,
    // same convention as attachment-search.integration.spec.ts's sibling setup.
    const organization = await prisma.organization.create({
      data: { id: randomUUID(), name: "ANN Test Client", type: "PRIVATE", createdById: userId },
    });
    organizationId = organization.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        tenderNumber: `ANN-${randomUUID().slice(0, 8)}`,
        title: "ANN Attachment Test Tender",
        department: "Test",
        clientId: organization.id,
        type: "OPEN",
        location: "Test",
        state: "Test",
        submissionDate: new Date(),
        businessId,
        createdById: userId,
      },
    });
    tenderId = tender.id;
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("ranks the closest embedded attachment first and excludes rows below threshold", async () => {
    const dims = 1024;
    const near = new Array(dims).fill(0);
    near[0] = 1;
    const far = new Array(dims).fill(0);
    far[1] = 1;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    await insertEmbeddedAttachment("near.pdf", near);
    await insertEmbeddedAttachment("far.pdf", far);

    const results = await repository.findNearestAttachments([tenderId], query, 5, 0.9);

    expect(results).toHaveLength(1);
    expect(results[0]?.originalName).toBe("near.pdf");
    expect(results[0]?.similarity).toBeCloseTo(1, 5);
  });

  it("respects the limit", async () => {
    const dims = 1024;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    const results = await repository.findNearestAttachments([tenderId], query, 1, 0);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
