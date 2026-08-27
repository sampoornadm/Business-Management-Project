import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GENERIC_UPLOAD_LIMITS } from "../../../config/constants.js";
import { env } from "../../../config/env.js";
import { documentIndexingQueue } from "../../../infra/queue/queues.js";
import { attachmentsService } from "../attachments.module.js";

describe("attachmentsService.upload — document indexing enqueue (integration)", () => {
  const originalFlag = env.DOCUMENT_INDEXING_ENABLED;
  let uploadedById: string;

  beforeAll(async () => {
    const { prisma } = await import("@bmp/database");
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `enqueue-test-${randomUUID()}@example.com`,
        passwordHash: "not-a-real-hash",
        firstName: "Enqueue",
        lastName: "Tester",
        isActive: true,
        isEmailVerified: true,
      },
    });
    uploadedById = user.id;
  });

  afterAll(async () => {
    env.DOCUMENT_INDEXING_ENABLED = originalFlag;
    const { prisma } = await import("@bmp/database");
    // Attachment.uploadedById is onDelete: Restrict — the uploads made by the
    // tests above must be deleted first or the user deleteMany violates the FK.
    await prisma.attachment.deleteMany({ where: { uploadedById } });
    await prisma.user.deleteMany({ where: { id: uploadedById } });
    await prisma.$disconnect();
  });

  it("adds a job to the queue when the flag is on", async () => {
    env.DOCUMENT_INDEXING_ENABLED = true;
    const { original } = await attachmentsService.upload({
      fileBuffer: Buffer.from("%PDF-1.4 fake"),
      originalName: "enqueue-test.pdf",
      declaredMimeType: "application/pdf",
      entityType: "Tender",
      entityId: randomUUID(),
      uploadedById,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    });

    const waiting = await documentIndexingQueue.getJobs(["waiting", "active", "completed"]);
    expect(waiting.some((job) => job.data.attachmentId === original.id)).toBe(true);
  });

  it("does not enqueue when the flag is off", async () => {
    env.DOCUMENT_INDEXING_ENABLED = false;
    const { original } = await attachmentsService.upload({
      fileBuffer: Buffer.from("%PDF-1.4 fake 2"),
      originalName: "enqueue-test-2.pdf",
      declaredMimeType: "application/pdf",
      entityType: "Tender",
      entityId: randomUUID(),
      uploadedById,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    });

    const jobs = await documentIndexingQueue.getJobs(["waiting", "active", "completed"]);
    expect(jobs.some((job) => job.data.attachmentId === original.id)).toBe(false);
  });
});
