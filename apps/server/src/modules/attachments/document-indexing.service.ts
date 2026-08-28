import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed } from "../../infra/llm/ollama.client.js";
import { prisma } from "../../infra/prisma/client.js";
import { s3Service } from "../../infra/storage/s3.service.js";
import { logger } from "../../shared/logger/logger.js";
import { extractPdfText } from "../../shared/utils/pdf-text.js";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_EXTRACT_CHARS = 8000;

/**
 * Best-effort text extraction for content search — same "best effort" philosophy as this
 * codebase's BOQ PDF parsing. Returns null (not throw) for anything it doesn't know how to
 * read, so an unsupported file (e.g. a drawing image) just skips content-embedding and stays
 * searchable by filename/document-type only.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  if (mimeType === "application/pdf") {
    try {
      const text = await extractPdfText(buffer);
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  if (mimeType === DOCX_MIME_TYPE) {
    try {
      const doc = new Docxtemplater(new PizZip(buffer));
      const text = doc.getFullText().trim();
      return text || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Runs off the BullMQ document-indexing queue (see infra/queue/workers/document-indexing.worker.ts).
 * Never throws for "this document couldn't be indexed" reasons — extraction/embedding is an
 * enhancement, not something that should fail a job retry loop over an unsupported file type.
 */
export async function indexAttachment(attachmentId: string): Promise<void> {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, storagePath: true, mimeType: true },
  });
  if (!attachment) return; // deleted between enqueue and processing — nothing to index

  const buffer = await s3Service.getObject(attachment.storagePath);
  const text = await extractText(buffer, attachment.mimeType);
  if (!text) return; // unsupported type (e.g. an image) — filename/type search still covers it

  const truncated = text.slice(0, MAX_EXTRACT_CHARS);

  try {
    const [vector] = await embed([truncated]);
    if (!vector) {
      await prisma.attachment.update({ where: { id: attachmentId }, data: { extractedText: truncated } });
      return;
    }
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { extractedText: truncated, embedding: vector, embeddedAt: new Date() },
    });
  } catch (err) {
    if (!(err instanceof ServiceUnavailableError)) throw err;
    // Extraction doesn't need Ollama — store the text now and let a later re-index (or a
    // future manual retry) fill in the embedding once Ollama's back, rather than losing the
    // extraction work too.
    await prisma.attachment.update({ where: { id: attachmentId }, data: { extractedText: truncated } });
    logger.warn({ attachmentId, err: err.message }, "Stored extracted text without embedding — Ollama unavailable");
    return;
  }
  logger.info({ attachmentId }, "Indexed attachment for content search");
}
