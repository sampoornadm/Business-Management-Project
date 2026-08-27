# Document Search & Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tender document content-searchable (extract text, embed, cosine-rank) through
the existing `/search` endpoint, and add a retrieval-only chat page (`/assistant`) as a
natural-language front-end over that same search.

**Architecture:** Reuses three things already in this codebase instead of building new
infrastructure: `HistoricalRate`'s embedding pattern (plain `Float[]` column + brute-force cosine
in JS, no vector database), the local Ollama client (`embed`/`generateJson`/`generateText`) already
wired up for BOQ enrichment, and the existing `/search` endpoint (extended with a new
`"Attachment"` result type rather than built as a separate system). A BullMQ worker extracts text
and embeds attachments in the background, off the upload/download request path.

**Tech Stack:** Prisma/PostgreSQL (new `Attachment` columns), BullMQ/Redis (indexing queue),
`pdf-parse` and `docxtemplater` (already-installed text extraction), local Ollama (already
integrated), Next.js/React (new `/assistant` page, `/search` extension).

**Spec:** `docs/superpowers/specs/2026-08-27-document-search-assistant-design.md`

## Global Constraints

- No new npm dependencies — `pdf-parse`, `docxtemplater`, `bullmq` are all already installed.
- No vector database — `Float[]` column + `cosineSimilarity` (`shared/utils/math.ts`), same as
  `HistoricalRate.embedding`.
- One embedding per document, truncated to the first 8,000 extracted characters — no chunking.
- Every new background-processing behavior is gated behind a flag defaulting to **off**
  (`DOCUMENT_INDEXING_ENABLED`), same convention as `LOCAL_DOCS_SYNC_ENABLED`/
  `AI_ENRICHMENT_ENABLED` — an environment that hasn't opted in sees zero behavior change.
- `/assistant` and the `Attachment` search type both reuse the existing `reports:read` permission
  — no new RBAC key.
- Ollama being down degrades gracefully everywhere (matches `ai-enrichment.worker.ts`'s own
  handling): indexing still stores extracted text without an embedding; search still returns
  metadata matches without content matches; the assistant still searches using the raw message
  without LLM intent-parsing.

---

### Task 1: `Attachment` schema columns for content search

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `Attachment.extractedText: string | null`, `Attachment.embedding: number[]`,
  `Attachment.embeddedAt: Date | null` — consumed by every later task.

- [ ] **Step 1: Add the three columns to the `Attachment` model**

Find the `Attachment` model (has `uploadedById`/`uploadedBy` near the bottom) and add, right after
the existing `isCurrent` field:

```prisma
  // Content search (#2/#3 — see docs/superpowers/specs/2026-08-27-document-search-assistant-design.md).
  // Populated lazily by the document-indexing worker. Plain Float[] + brute-force cosine in
  // application code, same convention as HistoricalRate.embedding below — not pgvector.
  extractedText String?
  embedding     Float[]
  embeddedAt    DateTime?
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm db:migrate --name add_attachment_content_search`
Expected: a new folder under `packages/database/prisma/migrations/` adding three nullable/
empty-default columns to the `attachments` table; no data loss, no other tables touched.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: completes without error. (Per this project's own gotcha list — skipping this step
after a schema change leaves the generated client without the new fields, causing confusing
`undefined`-property errors later, not at this step.)

- [ ] **Step 4: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(database): add content-search columns to Attachment"
```

---

### Task 2: Config flags

**Files:**
- Modify: `apps/server/src/config/env.ts`

**Interfaces:**
- Produces: `env.DOCUMENT_INDEXING_ENABLED: boolean`, `env.DOCUMENT_MATCH_THRESHOLD: number`.

- [ ] **Step 1: Add both to the schema**

Add after the existing `INCOMING_TENDERS_INGESTION_ENABLED` line (still inside the same
`z.object({...})`, before the closing `});`):

```ts
  // Opt-in: extracts text and embeds every tender-document Attachment in the background, so it
  // becomes searchable via /search and /assistant. Off by default — same convention as
  // AI_ENRICHMENT_ENABLED (extraction/embedding costs CPU on every upload otherwise).
  DOCUMENT_INDEXING_ENABLED: booleanEnv("false"),
  // Cosine similarity a document's content embedding must clear to appear as a content match in
  // search. Unmeasured placeholder — unlike AI_MATCH_THRESHOLD (calibrated against real BOQ
  // items), no real indexed documents exist yet to measure against. Re-measure once they do,
  // same way AI_MATCH_THRESHOLD was measured against bge-m3 rather than guessed.
  DOCUMENT_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes (no other file references these yet, so this alone can't fail).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/config/env.ts
git commit -m "feat(server): add DOCUMENT_INDEXING_ENABLED and DOCUMENT_MATCH_THRESHOLD flags"
```

---

### Task 3: Text extraction (pure function, unit tested)

**Files:**
- Create: `apps/server/src/modules/attachments/document-indexing.service.ts`
- Test: `apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts`

**Interfaces:**
- Consumes: `pdf-parse` (`import pdfParse from "pdf-parse"`), `docxtemplater` + `pizzip` (same
  imports as `document-generation.service.ts`).
- Produces: `extractText(buffer: Buffer, mimeType: string): Promise<string | null>` — consumed by
  Task 4's `indexAttachment`.

- [ ] **Step 1: Write the failing tests**

```ts
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";

import { extractText } from "../document-indexing.service.js";

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

function buildTestPdfBuffer(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text(text);
    doc.end();
  });
}

describe("extractText", () => {
  it("extracts text from a PDF buffer", async () => {
    const buffer = await buildTestPdfBuffer("Notice Inviting Tender for XLPE Cable Supply");
    const result = await extractText(buffer, "application/pdf");
    expect(result).toContain("Notice Inviting Tender for XLPE Cable Supply");
  });

  it("extracts text from a DOCX buffer", async () => {
    const buffer = buildTestDocxBuffer("Undertaking for tender TND-2026-001");
    const result = await extractText(
      buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result).toContain("Undertaking for tender TND-2026-001");
  });

  it("returns null for a mime type with no extractor (e.g. an image)", async () => {
    const result = await extractText(Buffer.from("fake image bytes"), "image/png");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.spec.ts`
Expected: FAIL — `extractText` is not exported (file doesn't exist yet).

- [ ] **Step 3: Implement `extractText`**

```ts
// apps/server/src/modules/attachments/document-indexing.service.ts
import Docxtemplater from "docxtemplater";
import pdfParse from "pdf-parse";
import PizZip from "pizzip";

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Best-effort text extraction for content search — same "best effort" philosophy as this
 * codebase's BOQ PDF parsing. Returns null (not throw) for anything it doesn't know how to
 * read, so an unsupported file (e.g. a drawing image) just skips content-embedding and stays
 * searchable by filename/document-type only.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
  if (mimeType === "application/pdf") {
    try {
      const data = await pdfParse(buffer);
      return data.text.trim() || null;
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
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/attachments/document-indexing.service.ts apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts
git commit -m "feat(attachments): add best-effort PDF/DOCX text extraction"
```

---

### Task 4: `indexAttachment` — the indexing job's core logic

**Files:**
- Modify: `apps/server/src/infra/storage/s3.service.ts`
- Modify: `apps/server/src/modules/attachments/document-indexing.service.ts`
- Test: `apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`

**Interfaces:**
- Consumes: `extractText` (Task 3), `s3Service.getObject` (this task), `embed` from
  `infra/llm/ollama.client.js`, `prisma` from `infra/prisma/client.js`.
- Produces: `indexAttachment(attachmentId: string): Promise<void>` — consumed by Task 5's worker.

- [ ] **Step 1: Add `getObject` to `s3Service`**

`s3Service` currently has `putObject`/`getPresignedUrl`/`deleteObject` but nothing to read a
file's bytes back out — needed here for the first time. Add, after `putObject`:

```ts
  async getObject(key: string): Promise<Buffer> {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  },
```

(`GetObjectCommand` is already imported in this file for `getPresignedUrl` — no new import
needed.)

- [ ] **Step 2: Write the failing integration test**

This hits real Postgres and real MinIO (this project's existing test infra) but mocks the Ollama
embed call — same hybrid approach `boq-enrichment.service.spec.ts` uses for the LLM piece, since
a live Ollama isn't guaranteed available wherever this test runs.

```ts
// apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { s3Service } from "../../../infra/storage/s3.service.js";
import { indexAttachment } from "../document-indexing.service.js";

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

    await s3Service.putObject({
      key: storagePath,
      body: Buffer.from("%PDF-1.4\nplaceholder — extraction failure is fine for this test"),
      contentType: "application/pdf",
    });

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
    embedMock.mockResolvedValue([[0.1, 0.2, 0.3]]);

    await indexAttachment(attachmentId);

    const updated = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(updated.extractedText).not.toBeNull();
    expect(updated.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(updated.embeddedAt).not.toBeNull();
  });

  it("does nothing for an attachment id that no longer exists (race with deletion)", async () => {
    await expect(indexAttachment(randomUUID())).resolves.toBeUndefined();
  });

  it("truncates extracted text to 8000 characters before embedding", async () => {
    embedMock.mockResolvedValue([[0.4, 0.5, 0.6]]);
    const longTextPath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;
    await s3Service.putObject({
      key: longTextPath,
      body: await buildLongPdfBuffer(9000), // helper below — a real PDF whose extracted text exceeds 8000 chars
      contentType: "application/pdf",
    });
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
    embedMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    const noOllamaPath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;
    await s3Service.putObject({
      key: noOllamaPath,
      body: await buildLongPdfBuffer(50),
      contentType: "application/pdf",
    });
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
```

Add this helper near the top of the test file, alongside the other imports — builds a real PDF
whose extracted text is at least `minChars` long, by repeating a line pdfkit will wrap across
enough pages:

```ts
import PDFDocument from "pdfkit";

function buildLongPdfBuffer(minChars: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const line = "Notice inviting tender for cable supply. ";
    const repeats = Math.ceil(minChars / line.length);
    doc.text(line.repeat(repeats));
    doc.end();
  });
}
```

- [ ] **Step 3: Run test, confirm it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`
Expected: FAIL — `indexAttachment` is not exported yet.

- [ ] **Step 4: Implement `indexAttachment`**

Add to `document-indexing.service.ts` (alongside `extractText`):

```ts
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed } from "../../infra/llm/ollama.client.js";
import { prisma } from "../../infra/prisma/client.js";
import { s3Service } from "../../infra/storage/s3.service.js";
import { logger } from "../../shared/logger/logger.js";

const MAX_EXTRACT_CHARS = 8000;

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
```

- [ ] **Step 5: Run test, confirm it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`
Expected: PASS (4 tests). Requires `docker compose up -d postgres minio minio-init` running and
migrations applied, same as every other integration spec in this project.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/infra/storage/s3.service.ts apps/server/src/modules/attachments/document-indexing.service.ts apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts
git commit -m "feat(attachments): add indexAttachment (extract, embed, store)"
```

---

### Task 5: Indexing queue + worker

**Files:**
- Modify: `apps/server/src/infra/queue/queues.ts`
- Create: `apps/server/src/infra/queue/workers/document-indexing.worker.ts`

**Interfaces:**
- Consumes: `indexAttachment` (Task 4).
- Produces: `DocumentIndexingJobPayload`, `DOCUMENT_INDEXING_QUEUE_NAME`, `documentIndexingQueue`
  (consumed by Task 6's enqueue call), `startDocumentIndexingWorker()` (consumed by Task 6's
  `worker.ts` registration).

- [ ] **Step 1: Add the queue definition**

Add to `queues.ts`, after the existing `aiEnrichmentQueue` block:

```ts
export interface DocumentIndexingJobPayload {
  attachmentId: string;
}

export const DOCUMENT_INDEXING_QUEUE_NAME = "document-indexing";

export const documentIndexingQueue = new Queue<DocumentIndexingJobPayload, void, "index-document">(
  DOCUMENT_INDEXING_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);
```

- [ ] **Step 2: Write the worker**

Thinner than `ai-enrichment.worker.ts`'s own `ServiceUnavailableError` catch: that pattern isn't
needed here because `indexAttachment` (Task 4) already catches it internally and degrades to
"store the text, skip the embedding" — by the time control returns to this worker, Ollama being
down is no longer an error case to special-case, just a `logger.info` either way.

```ts
// apps/server/src/infra/queue/workers/document-indexing.worker.ts
import { Worker } from "bullmq";

import { indexAttachment } from "../../../modules/attachments/document-indexing.service.js";
import { logger } from "../../../shared/logger/logger.js";
import { redis } from "../../redis/client.js";
import { DOCUMENT_INDEXING_QUEUE_NAME, type DocumentIndexingJobPayload } from "../queues.js";

export function startDocumentIndexingWorker(): Worker<DocumentIndexingJobPayload, void, "index-document"> {
  const worker = new Worker<DocumentIndexingJobPayload, void, "index-document">(
    DOCUMENT_INDEXING_QUEUE_NAME,
    async (job) => {
      await indexAttachment(job.data.attachmentId);
    },
    // Single-machine, CPU-only inference — same reasoning as ai-enrichment.worker.ts.
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, attachmentId: job?.data.attachmentId, err }, "Document indexing job failed");
  });

  return worker;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/infra/queue/queues.ts apps/server/src/infra/queue/workers/document-indexing.worker.ts
git commit -m "feat(server): add document-indexing BullMQ queue and worker"
```

---

### Task 6: Wire it up — enqueue on upload, start the worker

**Files:**
- Modify: `apps/server/src/modules/attachments/attachments.service.ts`
- Modify: `apps/server/src/worker.ts`
- Test: `apps/server/src/modules/attachments/__tests__/document-indexing-enqueue.integration.spec.ts`

**Interfaces:**
- Consumes: `documentIndexingQueue` (Task 5), `startDocumentIndexingWorker` (Task 5),
  `env.DOCUMENT_INDEXING_ENABLED` (Task 2).

- [ ] **Step 1: Write the failing integration test**

Proves the enqueue happens without needing a running worker — checks the queue's own state
directly (BullMQ + real Redis, same infra every other integration test already uses).

```ts
// apps/server/src/modules/attachments/__tests__/document-indexing-enqueue.integration.spec.ts
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { env } from "../../../config/env.js";
import { documentIndexingQueue } from "../../../infra/queue/queues.js";
import { GENERIC_UPLOAD_LIMITS } from "../../../config/constants.js";
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
```

- [ ] **Step 2: Run test, confirm it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing-enqueue.integration.spec.ts`
Expected: FAIL — first test's `expect(...).toBe(true)` fails (nothing enqueues yet).

- [ ] **Step 3: Add the enqueue call**

In `attachments.service.ts`, add imports:

```ts
import { env } from "../../config/env.js";
import { documentIndexingQueue } from "../../infra/queue/queues.js";
```

Then, in `upload()`, right after the `original` row is created (after the `if (!documentGroupId) {...}`
block, before the thumbnail-variant block), add:

```ts
    if (env.DOCUMENT_INDEXING_ENABLED) {
      await documentIndexingQueue.add("index-document", { attachmentId: original.id });
    }
```

- [ ] **Step 4: Run test, confirm it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing-enqueue.integration.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Register the worker in `worker.ts`**

```ts
// add to imports
import { startDocumentIndexingWorker } from "./infra/queue/workers/document-indexing.worker.js";

// add alongside the other conditional worker starts
const documentIndexingWorker = env.DOCUMENT_INDEXING_ENABLED ? startDocumentIndexingWorker() : undefined;
```

Add `documentIndexingWorker?.close()` to the `Promise.all([...])` in `shutdown()`, and extend the
startup log line's conditional-suffix chain with
`${documentIndexingWorker ? ", document indexing" : ""}`.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes.

- [ ] **Step 7: Run the full attachments/bills/document-generation test suites (regression check)**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments src/modules/bills src/modules/document-generation src/modules/tenders/local-docs`
Expected: all pass — `DOCUMENT_INDEXING_ENABLED` defaults to `false`, so every existing upload
path (direct uploads, local-docs-sync, phase-1's generated-document save) is unaffected.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/attachments/attachments.service.ts apps/server/src/worker.ts apps/server/src/modules/attachments/__tests__/document-indexing-enqueue.integration.spec.ts
git commit -m "feat(attachments): enqueue document-indexing job on upload, start worker"
```

---

### Task 7: `Attachment` as a search entity type

**Files:**
- Modify: `packages/types/src/report.ts`

**Interfaces:**
- Produces: `SearchEntityType` now includes `"Attachment"` — consumed by Task 9 (backend mapping)
  and Task 11 (frontend icon maps).

- [ ] **Step 1: Widen the union**

```ts
export const SEARCH_ENTITY_TYPES = ["Tender", "Organization", "Vendor", "Project", "Attachment"] as const;
```

- [ ] **Step 2: Typecheck both apps — this is expected to fail**

Run: `pnpm --filter @bmp/server typecheck` and (separately, not while the dev server is running —
see this project's own `.next` race gotcha) `pnpm --filter @bmp/web typecheck`
Expected: **both fail** — `apps/web/src/app/(dashboard)/search/page.tsx`'s and
`apps/web/src/components/layout/topbar-search.tsx`'s `Record<SearchEntityType, Icon>` maps are no
longer exhaustive. This is the compiler doing exactly its job (per the design doc: "TypeScript's
exhaustiveness check on that `Record` forces both, so neither can be missed") — Task 11 fixes
both. Confirm the failures are specifically about these two files' `ENTITY_ICONS` before moving
on, so a real unrelated break isn't mistaken for this expected one.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/report.ts
git commit -m "feat(types): add Attachment to SearchEntityType"
```

---

### Task 8: `searchAttachments` — repository layer

**Files:**
- Modify: `apps/server/src/modules/reports/reports.repository.ts`

**Interfaces:**
- Produces (added to `IReportsRepository`):
  - `findTenderIdsForBusiness(businessId: string): Promise<{ id: string; tenderNumber: string }[]>`
  - `searchAttachmentsByMetadata(tenderIds: string[], query: string): Promise<AttachmentMetadataRow[]>`
  - `findEmbeddedAttachments(tenderIds: string[]): Promise<EmbeddedAttachmentRow[]>`

  where:

  ```ts
  export interface AttachmentMetadataRow {
    id: string;
    originalName: string;
    documentType: string | null;
    entityId: string; // the tender id (Attachment.entityType/entityId is an unenforced generic reference)
  }
  export interface EmbeddedAttachmentRow extends AttachmentMetadataRow {
    embedding: number[];
  }
  ```

  Consumed by Task 9's `reports.service.ts`.

- [ ] **Step 1: Add the three interface methods and their implementations**

Add to the `IReportsRepository` interface (after `searchProjects`):

```ts
  findTenderIdsForBusiness(businessId: string): Promise<{ id: string; tenderNumber: string }[]>;
  searchAttachmentsByMetadata(tenderIds: string[], query: string): Promise<AttachmentMetadataRow[]>;
  findEmbeddedAttachments(tenderIds: string[]): Promise<EmbeddedAttachmentRow[]>;
```

Add the two row-shape interfaces above the `IReportsRepository` interface (same file, near the
other `*Row` interfaces at the top).

Add the implementations to `ReportsRepository` (after `searchProjects`):

```ts
  findTenderIdsForBusiness(businessId: string): Promise<{ id: string; tenderNumber: string }[]> {
    return this.prisma.tender.findMany({
      where: { businessId },
      select: { id: true, tenderNumber: true },
    });
  }

  searchAttachmentsByMetadata(tenderIds: string[], query: string): Promise<AttachmentMetadataRow[]> {
    if (tenderIds.length === 0) return Promise.resolve([]);
    return this.prisma.attachment.findMany({
      where: {
        entityType: "Tender",
        entityId: { in: tenderIds },
        variant: "ORIGINAL",
        OR: [
          { originalName: { contains: query, mode: "insensitive" } },
          { documentType: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, originalName: true, documentType: true, entityId: true },
      take: SEARCH_LIMIT,
    });
  }

  findEmbeddedAttachments(tenderIds: string[]): Promise<EmbeddedAttachmentRow[]> {
    if (tenderIds.length === 0) return Promise.resolve([]);
    return this.prisma.attachment.findMany({
      where: {
        entityType: "Tender",
        entityId: { in: tenderIds },
        variant: "ORIGINAL",
        embeddedAt: { not: null },
      },
      select: { id: true, originalName: true, documentType: true, entityId: true, embedding: true },
    });
  }
```

(`variant: "ORIGINAL"` excludes an image's THUMBNAIL row, which carries the same `originalName`
as its parent and would otherwise show up as a confusing duplicate result.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: fails — `ReportsService`'s `FakeReportsRepository`-adjacent real class now satisfies
`IReportsRepository`, but nothing calls these new methods yet, and (from Task 7) the frontend
icon maps are still failing. Confirm no *new* server-side type error appears beyond what Task 7
already introduced.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/reports/reports.repository.ts
git commit -m "feat(reports): add attachment search queries to ReportsRepository"
```

---

### Task 9: Wire attachment search into `ReportsService.search`

**Files:**
- Modify: `apps/server/src/modules/reports/reports.service.ts`
- Modify: `apps/server/src/modules/reports/__tests__/reports.service.spec.ts`

**Interfaces:**
- Consumes: Task 8's three repository methods; `embed` and `cosineSimilarity`;
  `env.DOCUMENT_MATCH_THRESHOLD` (Task 2).
- Produces: `search()` now includes `"Attachment"` results — this is what Task 10's integration
  test and Task 13's assistant service both rely on.

- [ ] **Step 1: Extend `FakeReportsRepository` and write the failing tests**

In `reports.service.spec.ts`, add to `FakeReportsRepository`:

```ts
  tenderIdsForBusiness: { id: string; tenderNumber: string }[] = [];
  attachmentMetadataMatches: AttachmentMetadataRow[] = [];
  embeddedAttachments: EmbeddedAttachmentRow[] = [];

  async findTenderIdsForBusiness(_businessId: string) {
    return this.tenderIdsForBusiness;
  }
  async searchAttachmentsByMetadata(_tenderIds: string[], _query: string) {
    return this.attachmentMetadataMatches;
  }
  async findEmbeddedAttachments(_tenderIds: string[]) {
    return this.embeddedAttachments;
  }
```

(Add `AttachmentMetadataRow`/`EmbeddedAttachmentRow` to the existing `import type { ... } from
"../reports.repository.js"` line.)

Add the mock hoist + mock near the top of the file, before the `describe` block:

```ts
const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));
```

(add `vi` to the existing `import { describe, expect, it } from "vitest";` line)

Add tests inside the `describe("ReportsService", ...)` block:

```ts
  it("includes a metadata-matched attachment in search results", async () => {
    const tenderId = randomUUID();
    const attachmentId = randomUUID();
    repository.tenderIdsForBusiness = [{ id: tenderId, tenderNumber: "TND-1" }];
    repository.attachmentMetadataMatches = [
      { id: attachmentId, originalName: "BILL-ABC123.pdf", documentType: "BILL", entityId: tenderId },
    ];

    const result = await service.search(businessId, "BILL-ABC123");

    expect(result.results).toContainEqual({
      type: "Attachment",
      id: attachmentId,
      title: "BILL-ABC123.pdf",
      subtitle: "TND-1",
      href: `/tenders/${tenderId}?tab=documents`,
    });
  });

  it("includes a content-matched attachment when its embedding clears the threshold", async () => {
    const tenderId = randomUUID();
    const attachmentId = randomUUID();
    repository.tenderIdsForBusiness = [{ id: tenderId, tenderNumber: "TND-2" }];
    repository.embeddedAttachments = [
      { id: attachmentId, originalName: "NIT.pdf", documentType: "NIT", entityId: tenderId, embedding: [1, 0] },
    ];
    embedMock.mockResolvedValue([[1, 0]]); // identical vector — cosine similarity 1.0

    const result = await service.search(businessId, "cable supply notice");

    expect(result.results.some((r) => r.id === attachmentId)).toBe(true);
  });

  it("excludes a content match below DOCUMENT_MATCH_THRESHOLD", async () => {
    const tenderId = randomUUID();
    repository.tenderIdsForBusiness = [{ id: tenderId, tenderNumber: "TND-3" }];
    repository.embeddedAttachments = [
      { id: randomUUID(), originalName: "unrelated.pdf", documentType: "GENERAL", entityId: tenderId, embedding: [0, 1] },
    ];
    embedMock.mockResolvedValue([[1, 0]]); // orthogonal vector — cosine similarity 0

    const result = await service.search(businessId, "cable supply notice");

    expect(result.results.some((r) => r.type === "Attachment")).toBe(false);
  });

  it("dedupes an attachment that matches both by metadata and by content", async () => {
    const tenderId = randomUUID();
    const attachmentId = randomUUID();
    repository.tenderIdsForBusiness = [{ id: tenderId, tenderNumber: "TND-4" }];
    const row = { id: attachmentId, originalName: "NIT.pdf", documentType: "NIT", entityId: tenderId };
    repository.attachmentMetadataMatches = [row];
    repository.embeddedAttachments = [{ ...row, embedding: [1, 0] }];
    embedMock.mockResolvedValue([[1, 0]]);

    const result = await service.search(businessId, "NIT");

    expect(result.results.filter((r) => r.id === attachmentId)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports/__tests__/reports.service.spec.ts`
Expected: FAIL — `search()` doesn't call any of the new repository methods yet, so no
`"Attachment"` results are ever produced.

- [ ] **Step 3: Implement the wiring**

Add imports to `reports.service.ts`:

```ts
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { env } from "../../config/env.js";
import { embed } from "../../infra/llm/ollama.client.js";
import { cosineSimilarity } from "../../shared/utils/math.js";

import type { AttachmentMetadataRow } from "./reports.repository.js";
```

Replace the body of `search()`:

```ts
  async search(businessId: string, query: string): Promise<SearchResultsDto> {
    const trimmed = query.trim();
    if (trimmed.length < 2) throw new BadRequestError("Search query must be at least 2 characters");

    const [tenders, organizations, vendors, projects, tenderIdRows] = await Promise.all([
      this.reportsRepository.searchTenders(businessId, trimmed),
      this.reportsRepository.searchOrganizations(trimmed),
      this.reportsRepository.searchVendors(trimmed),
      this.reportsRepository.searchProjects(businessId, trimmed),
      this.reportsRepository.findTenderIdsForBusiness(businessId),
    ]);

    const tenderNumberById = new Map(tenderIdRows.map((t) => [t.id, t.tenderNumber]));
    const tenderIds = tenderIdRows.map((t) => t.id);
    const attachmentResults = await this.searchAttachments(tenderIds, trimmed, tenderNumberById);

    const results: SearchResultItemDto[] = [
      ...tenders.map((t) => ({
        type: "Tender" as const,
        id: t.id,
        title: t.title,
        subtitle: t.tenderNumber,
        href: `/tenders/${t.id}`,
      })),
      ...organizations.map((o) => ({
        type: "Organization" as const,
        id: o.id,
        title: o.name,
        subtitle: null,
        href: `/organizations/${o.id}`,
      })),
      ...vendors.map((v) => ({
        type: "Vendor" as const,
        id: v.id,
        title: v.name,
        subtitle: null,
        href: `/vendors/${v.id}`,
      })),
      ...projects.map((p) => ({
        type: "Project" as const,
        id: p.id,
        title: p.name,
        subtitle: null,
        href: `/projects/${p.id}`,
      })),
      ...attachmentResults,
    ];

    return { query: trimmed, results };
  }

  private async searchAttachments(
    tenderIds: string[],
    query: string,
    tenderNumberById: Map<string, string>,
  ): Promise<SearchResultItemDto[]> {
    if (tenderIds.length === 0) return [];

    const [metadataMatches, embeddedRows] = await Promise.all([
      this.reportsRepository.searchAttachmentsByMetadata(tenderIds, query),
      this.reportsRepository.findEmbeddedAttachments(tenderIds),
    ]);

    let contentMatches: AttachmentMetadataRow[] = [];
    if (embeddedRows.length > 0) {
      try {
        const [queryVector] = await embed([query]);
        if (queryVector) {
          contentMatches = embeddedRows
            .map((row) => ({ row, similarity: cosineSimilarity(queryVector, row.embedding) }))
            .filter(({ similarity }) => similarity >= env.DOCUMENT_MATCH_THRESHOLD)
            .sort((a, b) => b.similarity - a.similarity)
            .map(({ row }) => row);
        }
      } catch (err) {
        // Content search is an enhancement on top of metadata search — Ollama being down must
        // not take down search entirely, same philosophy as document-indexing.worker.ts.
        if (!(err instanceof ServiceUnavailableError)) throw err;
      }
    }

    const merged = new Map<string, AttachmentMetadataRow>();
    for (const row of [...metadataMatches, ...contentMatches]) merged.set(row.id, row);

    return [...merged.values()].slice(0, 5).map((row) => ({
      type: "Attachment" as const,
      id: row.id,
      title: row.originalName,
      subtitle: tenderNumberById.get(row.entityId) ?? null,
      href: `/tenders/${row.entityId}?tab=documents`,
    }));
  }
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports/__tests__/reports.service.spec.ts`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes (frontend icon-map errors from Task 7 are unaffected by this server-only change
and will remain until Task 11 — that's expected).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/reports/reports.service.ts apps/server/src/modules/reports/__tests__/reports.service.spec.ts
git commit -m "feat(reports): include attachments (metadata + content match) in search results"
```

---

### Task 10: End-to-end integration proof

**Files:**
- Create: `apps/server/src/modules/reports/__tests__/attachment-search.integration.spec.ts`

**Interfaces:**
- Consumes: the real `/search` endpoint, real `indexAttachment` (called directly, not via the
  queue — proves the pipeline without depending on a running worker process).

- [ ] **Step 1: Write the test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));

import { createApp } from "../../../app.js";
import { indexAttachment } from "../../attachments/document-indexing.service.js";
import { s3Service } from "../../../infra/storage/s3.service.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

describe("GET /search — attachments (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let tenderId: string;
  let attachmentId: string;
  const storagePath = `tender/${randomUUID()}/${randomUUID()}-original.pdf`;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);

    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "Search Test Org", type: "GOVERNMENT", createdById: testUser.userId },
    });
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

    embedMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    await indexAttachment(attachmentId);
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { id: attachmentId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
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
```

- [ ] **Step 2: Run test, confirm it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports/__tests__/attachment-search.integration.spec.ts`
Expected: PASS. Requires `docker compose up -d postgres redis minio minio-init` and migrations
applied. If it fails on login-rate-limit-shaped errors from repeated runs, `docker compose exec
redis redis-cli FLUSHALL` first (known gotcha, not a real failure).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/reports/__tests__/attachment-search.integration.spec.ts
git commit -m "test(reports): add end-to-end attachment-search integration test"
```

---

### Task 11: Frontend — `Attachment` icon in both search surfaces

**Files:**
- Modify: `apps/web/src/app/(dashboard)/search/page.tsx`
- Modify: `apps/web/src/components/layout/topbar-search.tsx`

**Interfaces:**
- Consumes: `SearchEntityType` (Task 7, now includes `"Attachment"`).

- [ ] **Step 1: Fix `/search/page.tsx`**

Add `FileSearch` (or similar) to the `lucide-react` import, and add to `ENTITY_ICONS`:

```ts
  Attachment: FileSearch,
```

- [ ] **Step 2: Fix `topbar-search.tsx`**

Same addition to its own `ENTITY_ICONS`-equivalent map (same icon, same import).

- [ ] **Step 3: Typecheck the web app**

Stop the dev server first if it's running (this project's own `.next` race gotcha — running
`typecheck` alongside `pnpm dev` produces bogus `TS6053` errors), then:

Run: `pnpm --filter @bmp/web typecheck`
Expected: passes — this was the failure introduced back in Task 7; it's resolved now.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/search/page.tsx" apps/web/src/components/layout/topbar-search.tsx
git commit -m "feat(web): render Attachment results in search and quick-search"
```

---

### Task 12: Frontend — deep-link the tender page's Documents tab

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Produces: `/tenders/[id]?tab=documents` now actually opens the Documents tab — required for
  every attachment search/assistant result link to be useful, not just land on Overview.

- [ ] **Step 1: Make the tab controlled**

Add `useSearchParams` to the existing `next/navigation` import (already imports `useParams`,
`useRouter`), and inside the component:

```ts
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "overview";
```

Change `<Tabs defaultValue="overview">` to `<Tabs defaultValue={initialTab}>`. (Uncontrolled-with-
a-computed-default is enough here — the tab only needs to be *right on first load* from a search
result link, not kept in sync with the URL afterward, so this avoids adding `value`/
`onValueChange` state-management for a need that doesn't exist yet.)

- [ ] **Step 2: Manual verification**

Start the dev server (`pnpm dev`), open a tender detail page directly at
`/tenders/<id>?tab=documents` in the browser, confirm the Documents tab is selected on load, and
that `/tenders/<id>` (no query param) still defaults to Overview as before. (No new automated
test — this codebase's convention is Playwright E2E for page-level behavior, not added for
similarly-sized changes like the bills pages in phase 1.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx"
git commit -m "feat(web): deep-link the tender page's tab via ?tab= query param"
```

---

### Task 13: Assistant backend — intent parsing + search + reply

**Files:**
- Create: `packages/types/src/assistant.ts`
- Modify: `packages/types/src/index.ts`
- Create: `apps/server/src/modules/assistant/assistant.validation.ts`
- Create: `apps/server/src/modules/assistant/assistant.service.ts`
- Create: `apps/server/src/modules/assistant/assistant.controller.ts`
- Create: `apps/server/src/modules/assistant/assistant.routes.ts`
- Create: `apps/server/src/modules/assistant/assistant.module.ts`
- Modify: `apps/server/src/routes/v1.router.ts`
- Test: `apps/server/src/modules/assistant/__tests__/assistant.service.spec.ts`

**Interfaces:**
- Consumes: `ReportsService.search` (existing, now attachment-aware from Task 9),
  `generateJson`/`generateText` from `infra/llm/ollama.client.js`.
- Produces: `AssistantService.query(message: string, businessId: string): Promise<AssistantQueryResultDto>`,
  `POST /assistant/query` — consumed by Task 16's frontend hook.

- [ ] **Step 1: Add the shared types**

```ts
// packages/types/src/assistant.ts
import type { SearchResultItemDto } from "./report.js";

export interface AssistantQueryInput {
  message: string;
}

export interface AssistantQueryResultDto {
  reply: string;
  results: SearchResultItemDto[];
}
```

Add `export * from "./assistant.js";` to `packages/types/src/index.ts` (alongside the other
`export * from "./..."` lines).

- [ ] **Step 2: Validation**

```ts
// apps/server/src/modules/assistant/assistant.validation.ts
import { z } from "zod";

export const assistantQuerySchema = z.object({
  message: z.string().min(1).max(500),
});
export type AssistantQueryBody = z.infer<typeof assistantQuerySchema>;
```

- [ ] **Step 3: Write the failing service tests**

```ts
// apps/server/src/modules/assistant/__tests__/assistant.service.spec.ts
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SearchResultsDto } from "@bmp/types";

const { generateJsonMock, generateTextMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  generateTextMock: vi.fn(),
}));
vi.mock("../../../infra/llm/ollama.client.js", () => ({
  generateJson: generateJsonMock,
  generateText: generateTextMock,
}));

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { AssistantService } from "../assistant.service.js";

function fakeSearchService(result: SearchResultsDto) {
  return { search: vi.fn().mockResolvedValue(result) };
}

describe("AssistantService", () => {
  const businessId = randomUUID();

  it("uses the LLM-extracted tender number to build the search query", async () => {
    generateJsonMock.mockResolvedValue({
      tenderNumber: "TST-1783835577-Sam",
      documentType: "BILL",
      freeTextQuery: "bill",
    });
    generateTextMock.mockResolvedValue("Found it — here's the bill.");
    const searchResult: SearchResultsDto = {
      query: "TST-1783835577-Sam",
      results: [{ type: "Attachment", id: randomUUID(), title: "BILL-ABC.pdf", subtitle: "TST-1783835577-Sam", href: "/tenders/1?tab=documents" }],
    };
    const search = fakeSearchService(searchResult);
    const service = new AssistantService(search as never);

    const result = await service.query("find me the bill for tender TST-1783835577-Sam", businessId);

    expect(search.search).toHaveBeenCalledWith(businessId, expect.stringContaining("TST-1783835577-Sam"));
    expect(result.reply).toBe("Found it — here's the bill.");
    expect(result.results).toEqual(searchResult.results);
  });

  it("falls back to the raw message when Ollama can't parse intent", async () => {
    generateJsonMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    generateTextMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    const searchResult: SearchResultsDto = { query: "undertaking for TND-9", results: [] };
    const search = fakeSearchService(searchResult);
    const service = new AssistantService(search as never);

    const result = await service.query("undertaking for TND-9", businessId);

    expect(search.search).toHaveBeenCalledWith(businessId, "undertaking for TND-9");
    expect(result.reply).toBe("Nothing found matching that.");
  });

  it("replies with a deterministic message when nothing is found", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: null, documentType: null, freeTextQuery: "xyz" });
    const search = fakeSearchService({ query: "xyz", results: [] });
    const service = new AssistantService(search as never);

    const result = await service.query("xyz", businessId);

    expect(result.reply).toBe("Nothing found matching that.");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests, confirm they fail**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/assistant/__tests__/assistant.service.spec.ts`
Expected: FAIL — `assistant.service.ts` doesn't exist yet.

- [ ] **Step 5: Implement `AssistantService`**

```ts
// apps/server/src/modules/assistant/assistant.service.ts
import type { AssistantQueryResultDto } from "@bmp/types";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { generateJson, generateText } from "../../infra/llm/ollama.client.js";
import type { ReportsService } from "../reports/reports.service.js";

interface AssistantIntent {
  tenderNumber: string | null;
  documentType: string | null;
  freeTextQuery: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIntent(raw: unknown): AssistantIntent | null {
  if (!isRecord(raw)) return null;
  const freeTextQuery = typeof raw.freeTextQuery === "string" ? raw.freeTextQuery.trim() : "";
  if (!freeTextQuery) return null;
  const tenderNumber =
    typeof raw.tenderNumber === "string" && raw.tenderNumber.trim() ? raw.tenderNumber.trim() : null;
  const documentType =
    typeof raw.documentType === "string" && raw.documentType.trim() ? raw.documentType.trim() : null;
  return { tenderNumber, documentType, freeTextQuery };
}

function buildIntentPrompt(message: string): string {
  return [
    "Extract search hints from this request for a construction-tender document search system.",
    "",
    `Request: "${message}"`,
    "",
    "Return JSON only, with exactly these keys:",
    '  "tenderNumber": the tender number mentioned, exactly as written, or null if none',
    '  "documentType": one word for the kind of document if mentioned (e.g. "bill", "undertaking", "drawing"), or null',
    '  "freeTextQuery": the request rewritten as a short plain search query (2-6 words)',
  ].join("\n");
}

/** Retrieval-only: this never invents a document — it only paraphrases what search actually found. */
export class AssistantService {
  constructor(private readonly reportsService: Pick<ReportsService, "search">) {}

  async query(message: string, businessId: string): Promise<AssistantQueryResultDto> {
    let searchQuery = message;
    try {
      const raw = await generateJson(buildIntentPrompt(message));
      const intent = parseIntent(raw);
      if (intent) {
        searchQuery = [intent.tenderNumber, intent.documentType, intent.freeTextQuery]
          .filter((part): part is string => Boolean(part))
          .join(" ");
      }
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      // Ollama down: fall back to searching on the raw message, same degrade-gracefully
      // philosophy as document indexing and content search.
    }

    const searchResult = await this.reportsService.search(businessId, searchQuery);
    if (searchResult.results.length === 0) {
      return { reply: "Nothing found matching that.", results: [] };
    }

    try {
      const reply = await generateText(
        [
          `The user asked: "${message}"`,
          "Search found these results:",
          ...searchResult.results.map((r) => `- ${r.title}${r.subtitle ? ` (${r.subtitle})` : ""}`),
          "",
          "Reply in one short sentence confirming what was found. Do not invent anything not listed above.",
        ].join("\n"),
      );
      return { reply, results: searchResult.results };
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      return {
        reply: `Found ${searchResult.results.length} result(s) for "${message}".`,
        results: searchResult.results,
      };
    }
  }
}
```

- [ ] **Step 6: Run tests, confirm they pass**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/assistant/__tests__/assistant.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Controller, routes, module**

```ts
// apps/server/src/modules/assistant/assistant.controller.ts
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { AssistantService } from "./assistant.service.js";
import type { AssistantQueryBody } from "./assistant.validation.js";

export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  query = asyncHandler(async (req, res) => {
    const { message } = req.body as AssistantQueryBody;
    const result = await this.assistantService.query(message, req.user!.businessId);
    sendSuccess(res, result, "Assistant response");
  });
}
```

```ts
// apps/server/src/modules/assistant/assistant.routes.ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AssistantController } from "./assistant.controller.js";
import { assistantQuerySchema } from "./assistant.validation.js";

/** Mounted at /assistant */
export function createAssistantRouter(controller: AssistantController): Router {
  const router = Router();

  /**
   * @openapi
   * /assistant/query:
   *   post:
   *     tags: [Assistant]
   *     summary: Natural-language document search (retrieval only — no content Q&A)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Assistant reply plus matching search results }
   */
  router.post(
    "/query",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(assistantQuerySchema),
    controller.query,
  );

  return router;
}
```

```ts
// apps/server/src/modules/assistant/assistant.module.ts
import { reportsService } from "../reports/reports.module.js";

import { AssistantController } from "./assistant.controller.js";
import { createAssistantRouter } from "./assistant.routes.js";
import { AssistantService } from "./assistant.service.js";

const assistantService = new AssistantService(reportsService);
const assistantController = new AssistantController(assistantService);

export const assistantRouter = createAssistantRouter(assistantController);
```

(`reports.module.ts` already exports `reportsService` as a singleton alongside
`reportsController`/`reportsRouter`/`searchRouter` — confirmed, no change needed there.)

- [ ] **Step 8: Mount the router**

In `v1.router.ts`, add the import (alphabetically near the top) and the mount line (near
`searchRouter`):

```ts
import { assistantRouter } from "../modules/assistant/assistant.module.js";
// ...
v1Router.use("/assistant", assistantRouter);
```

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes.

- [ ] **Step 10: Commit**

```bash
git add packages/types/src/assistant.ts packages/types/src/index.ts apps/server/src/modules/assistant apps/server/src/routes/v1.router.ts
git commit -m "feat(assistant): add retrieval-only natural-language search endpoint"
```

---

### Task 14: Assistant integration test

**Files:**
- Create: `apps/server/src/modules/assistant/__tests__/assistant.integration.spec.ts`

**Interfaces:**
- Consumes: `POST /api/v1/assistant/query` end-to-end.

- [ ] **Step 1: Write the test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { generateJsonMock, generateTextMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  generateTextMock: vi.fn(),
}));
vi.mock("../../../infra/llm/ollama.client.js", () => ({
  generateJson: generateJsonMock,
  generateText: generateTextMock,
  embed: vi.fn().mockResolvedValue([[0, 0]]),
}));

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

describe("POST /assistant/query (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let tenderId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "Assistant Test Org", type: "GOVERNMENT", createdById: testUser.userId },
    });
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `ASSISTANT-IT-${Date.now()}`,
        title: "Assistant Test Tender",
        clientId: client.id,
        status: "DRAFT",
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("finds a tender by natural-language message referencing its number", async () => {
    generateJsonMock.mockResolvedValue({
      tenderNumber: null,
      documentType: null,
      freeTextQuery: tenderId, // not realistic LLM output, but exercises the real search fallback path
    });
    generateTextMock.mockResolvedValue("Found it.");

    const response = await request(app)
      .post("/api/v1/assistant/query")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ message: `find tender ${tenderId}` });

    expect(response.status).toBe(200);
    expect(typeof response.body.data.reply).toBe("string");
    expect(Array.isArray(response.body.data.results)).toBe(true);
  });

  it("rejects an empty message with a validation error", async () => {
    const response = await request(app)
      .post("/api/v1/assistant/query")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ message: "" });

    expect(response.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test, confirm it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/assistant/__tests__/assistant.integration.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/assistant/__tests__/assistant.integration.spec.ts
git commit -m "test(assistant): add end-to-end assistant query integration test"
```

---

### Task 15: Frontend — shared search-result-list component

**Files:**
- Create: `apps/web/src/components/search/search-result-list.tsx`
- Modify: `apps/web/src/app/(dashboard)/search/page.tsx`

**Interfaces:**
- Produces: `<SearchResultList results={SearchResultItemDto[]} />` — consumed by Task 16's
  `/assistant` page.

- [ ] **Step 1: Extract the component**

```tsx
// apps/web/src/components/search/search-result-list.tsx
"use client";

import type { SearchEntityType, SearchResultItemDto } from "@bmp/types";
import { Card, CardContent } from "@bmp/ui";
import { Building2, FileSearch, FileText, HardHat, Truck } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

const ENTITY_ICONS: Record<SearchEntityType, ComponentType<{ className?: string }>> = {
  Tender: FileText,
  Organization: Building2,
  Vendor: Truck,
  Project: HardHat,
  Attachment: FileSearch,
};

export function SearchResultList({ results }: { results: SearchResultItemDto[] }) {
  if (results.length === 0) return null;

  return (
    <Card>
      <CardContent className="divide-y p-0">
        {results.map((result) => {
          const Icon = ENTITY_ICONS[result.type];
          return (
            <Link
              key={`${result.type}-${result.id}`}
              href={result.href}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{result.title}</p>
                {result.subtitle && <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{result.type}</span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Use it from `/search/page.tsx`**

Replace the `<Card>...</Card>` block that renders `results.map(...)` with:

```tsx
<SearchResultList results={results} />
```

Remove the now-unused `ENTITY_ICONS` map and its now-unused icon imports from this file (the
component owns that rendering now) — keep the `Search` icon import (still used for the input's
magnifying-glass), and the empty/loading text branches above the result list unchanged.

- [ ] **Step 3: Typecheck**

Stop the dev server first (`.next` race gotcha), then:
Run: `pnpm --filter @bmp/web typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification**

Start the dev server, visit `/search`, type a query that matches a tender and (if Task 6-10's
flag was turned on and a document indexed) an attachment — confirm results render identically to
before this change.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/search/search-result-list.tsx "apps/web/src/app/(dashboard)/search/page.tsx"
git commit -m "refactor(web): extract SearchResultList for reuse by the assistant page"
```

---

### Task 16: Frontend — `/assistant` chat page

**Files:**
- Create: `apps/web/src/hooks/use-assistant.ts`
- Create: `apps/web/src/app/(dashboard)/assistant/page.tsx`
- Modify: `apps/web/src/components/layout/nav-items.ts`

**Interfaces:**
- Consumes: `POST /assistant/query` (Task 13), `<SearchResultList>` (Task 15).

- [ ] **Step 1: The hook**

```ts
// apps/web/src/hooks/use-assistant.ts
"use client";

import type { ApiResponse, AssistantQueryResultDto } from "@bmp/types";
import { useMutation } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useAssistantQuery() {
  return useMutation({
    mutationFn: async (message: string) => {
      const response = await apiClient.post<ApiResponse<AssistantQueryResultDto>>("/assistant/query", { message });
      return unwrap(response.data);
    },
  });
}
```

- [ ] **Step 2: The page**

```tsx
// apps/web/src/app/(dashboard)/assistant/page.tsx
"use client";

import type { AssistantQueryResultDto } from "@bmp/types";
import { Button, Input, useToast } from "@bmp/ui";
import { Send } from "lucide-react";
import { useState } from "react";

import { SearchResultList } from "@/components/search/search-result-list";
import { useAssistantQuery } from "@/hooks/use-assistant";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  results?: AssistantQueryResultDto["results"];
}

export default function AssistantPage() {
  const { toast } = useToast();
  const assistantQuery = useAssistantQuery();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);

    try {
      const result = await assistantQuery.mutateAsync(text);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: result.reply, results: result.results },
      ]);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Assistant error",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask for a document in plain language — e.g. &quot;find the bill for tender TND-2026-001&quot;.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "self-end" : "self-start"}>
            <div
              className={
                message.role === "user"
                  ? "rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "rounded-lg bg-muted px-3 py-2 text-sm"
              }
            >
              {message.text}
            </div>
            {message.results && message.results.length > 0 && (
              <div className="mt-2">
                <SearchResultList results={message.results} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSend();
          }}
          placeholder="Find the bill for tender..."
          disabled={assistantQuery.isPending}
        />
        <Button onClick={() => void handleSend()} disabled={assistantQuery.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar entry**

Add `Bot` to the `lucide-react` import in `nav-items.ts`, and add to `NAV_ITEMS` (near `Reports`):

```ts
  { label: "Assistant", href: "/assistant", icon: Bot, permission: "reports:read" },
```

- [ ] **Step 4: Typecheck**

Stop the dev server first, then:
Run: `pnpm --filter @bmp/web typecheck`
Expected: passes.

- [ ] **Step 5: Manual verification**

Start the dev server, log in, click "Assistant" in the sidebar, type "find the bill for tender
`<a real tender number from your dev data>`", confirm a reply appears with a result card, and
that clicking the card lands on that tender's Documents tab (proves Task 12's deep-link too, end
to end).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/use-assistant.ts "apps/web/src/app/(dashboard)/assistant/page.tsx" apps/web/src/components/layout/nav-items.ts
git commit -m "feat(web): add the Assistant chat page"
```

---

## Post-plan checklist

- [ ] Full server suite: `pnpm --filter @bmp/server exec vitest run` (flush Redis first if
  repeated runs have tripped the login rate limiter — known gotcha, not a real failure)
- [ ] Full web suite: `pnpm --filter @bmp/web exec vitest run`
- [ ] `pnpm --filter @bmp/server typecheck` and `pnpm --filter @bmp/web typecheck` (dev server
  stopped)
- [ ] `pnpm db:seed` — not required by this plan (no new RBAC permission keys were added), but
  worth a mental note for whoever eventually *does* add `assistant:*`-style keys later
- [ ] Manually flip `DOCUMENT_INDEXING_ENABLED=true` in `.env`, restart the worker, upload a real
  tender document, confirm it becomes searchable within a few seconds
