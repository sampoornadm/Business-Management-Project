import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { embedMock, extractPdfTextMock } = vi.hoisted(() => ({ embedMock: vi.fn(), extractPdfTextMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));
vi.mock("../../../shared/utils/pdf-text.js", () => ({ extractPdfText: extractPdfTextMock }));

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { s3Service } from "../../../infra/storage/s3.service.js";
import { indexAttachment } from "../document-indexing.service.js";

// pdf-parse is mocked (see above) — the buffer's actual bytes are never really parsed, only its
// presence in S3 matters (indexAttachment fetches it before calling extractText).
const PLACEHOLDER_PDF_BYTES = Buffer.from("placeholder — content is irrelevant, pdf-parse is mocked");

describe("indexAttachment (integration)", () => {
  let businessId: string;
  let userId: string;
  let attachmentId: string;
  const storagePath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "Indexing Test Business", code: `IDX${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `indexing-${randomUUID()}@example.com`,
        passwordHash: "not-a-real-hash",
        firstName: "Indexing",
        lastName: "Tester",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    await s3Service.putObject({ key: storagePath, body: PLACEHOLDER_PDF_BYTES, contentType: "application/pdf" });

    const attachment = await prisma.attachment.create({
      data: {
        id: randomUUID(),
        originalName: "test.pdf",
        storedName: "test.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        hash: randomUUID(),
        storageBucket: s3Service.bucket,
        storagePath,
        entityType: "Tender",
        entityId: randomUUID(),
        uploadedById: userId,
      },
    });
    attachmentId = attachment.id;
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: attachmentId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await s3Service.deleteObject(storagePath);
    await prisma.$disconnect();
  });

  it("extracts text, embeds it, and stores both on the attachment", async () => {
    extractPdfTextMock.mockResolvedValue("Notice inviting tender for cable supply");
    embedMock.mockResolvedValue([Array(1024).fill(0).map((_, i) => (i + 1) / 10000)]);

    await indexAttachment(attachmentId);

    const updated = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(updated.extractedText).toBe("Notice inviting tender for cable supply");
    expect(updated.embedding).toHaveLength(1024);
    expect(updated.embeddedAt).not.toBeNull();
  });

  it("does nothing for an attachment id that no longer exists (race with deletion)", async () => {
    await expect(indexAttachment(randomUUID())).resolves.toBeUndefined();
  });

  it("truncates extracted text to 8000 characters before embedding", async () => {
    extractPdfTextMock.mockResolvedValue("x".repeat(9000));
    embedMock.mockResolvedValue([Array(1024).fill(0).map((_, i) => (i + 2) / 10000)]);
    const longTextPath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;
    await s3Service.putObject({ key: longTextPath, body: PLACEHOLDER_PDF_BYTES, contentType: "application/pdf" });
    const longAttachment = await prisma.attachment.create({
      data: {
        id: randomUUID(),
        originalName: "long.pdf",
        storedName: "long.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        hash: randomUUID(),
        storageBucket: s3Service.bucket,
        storagePath: longTextPath,
        entityType: "Tender",
        entityId: randomUUID(),
        uploadedById: userId,
      },
    });

    await indexAttachment(longAttachment.id);

    const updated = await prisma.attachment.findUniqueOrThrow({ where: { id: longAttachment.id } });
    expect(updated.extractedText).toHaveLength(8000);

    await prisma.attachment.deleteMany({ where: { id: longAttachment.id } });
    await s3Service.deleteObject(longTextPath);
  });

  it("stores extracted text even when Ollama is unavailable, without an embedding", async () => {
    extractPdfTextMock.mockResolvedValue("Notice inviting tender for cable supply");
    embedMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    const noOllamaPath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;
    await s3Service.putObject({ key: noOllamaPath, body: PLACEHOLDER_PDF_BYTES, contentType: "application/pdf" });
    const attachmentNoOllama = await prisma.attachment.create({
      data: {
        id: randomUUID(),
        originalName: "no-ollama.pdf",
        storedName: "no-ollama.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        hash: randomUUID(),
        storageBucket: s3Service.bucket,
        storagePath: noOllamaPath,
        entityType: "Tender",
        entityId: randomUUID(),
        uploadedById: userId,
      },
    });

    await indexAttachment(attachmentNoOllama.id);

    const updated = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentNoOllama.id } });
    expect(updated.extractedText).not.toBeNull();
    expect(updated.embedding).toEqual([]);
    expect(updated.embeddedAt).toBeNull();

    await prisma.attachment.deleteMany({ where: { id: attachmentNoOllama.id } });
    await s3Service.deleteObject(noOllamaPath);
  });
});
