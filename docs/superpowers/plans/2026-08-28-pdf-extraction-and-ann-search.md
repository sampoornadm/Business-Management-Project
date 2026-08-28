# PDF Extraction Fix + ANN Vector Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `pdf-parse` package with a `pdftotext`-subprocess-backed utility at
all three call sites, and replace all three brute-force cosine-similarity "fetch every embedded
row, rank in JS" read paths (`Attachment`, `HistoricalRate`, `Item`) with pgvector HNSW-indexed ANN
queries.

**Architecture:** Part 1 (PDF) adds one shared subprocess-based extraction utility and swaps three
existing `pdf-parse` call sites to it, with zero behavioral change to any caller's contract. Part 2
(ANN) adds a `vector(1024)` column alongside each model's existing `Float[]` column (both kept in
sync on write), backed by an HNSW index; every existing "fetch all embedded rows for this
business/tender, cosine-rank in application code" method is replaced by one `$queryRaw` ANN query
per module, with all downstream threshold/dedup/LLM-prompt logic untouched.

**Tech Stack:** Node `child_process.spawn` (poppler's `pdftotext` CLI), PostgreSQL + `pgvector`
extension (HNSW index, `vector_cosine_ops`), Prisma `Unsupported("vector(N)")` + `$queryRaw`/
`$executeRaw`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-pdf-extraction-and-ann-search-design.md`

## Global Constraints

- `pdftotext` (poppler-utils) replaces `pdf-parse` at all three call sites; `pdf-parse` and
  `@types/pdf-parse` removed from `apps/server/package.json` entirely once nothing imports them.
- `embeddingVector Unsupported("vector(1024)")?` is added to `Attachment`, `HistoricalRate`, and
  `Item` alongside their existing `embedding Float[]` — the `Float[]` column is **kept**, not
  removed or backfilled-then-dropped.
- Every write to an existing `embedding`/`embeddedAt` pair also writes `embeddingVector` via one
  extra `$executeRaw` in the same method.
- Every brute-force "fetch every embedded row for this scope, cosine-rank in JS" method is replaced
  by one indexed `$queryRaw` ANN query returning top-K rows with `similarity` already computed;
  everything downstream of the ranked list (threshold comparisons, `sameSpec()`, dedup, DTO
  mapping) is unchanged.
- `1 - (a <=> b)` is this codebase's cosine-similarity convention in raw SQL (`<=>` is pgvector's
  cosine-*distance* operator; existing thresholds like `AI_MATCH_THRESHOLD`/`DOCUMENT_MATCH_THRESHOLD`
  are similarity values, `0..1`, higher = closer — never invert this without updating the threshold
  constants too).
- No OCR, no dynamic/configurable vector dimension, no CI automation for `poppler-utils`/pgvector —
  both are documented manual prerequisites, same class of requirement as the existing MinIO test
  bucket.
- Docker: `apps/server/Dockerfile` is shared by both the `server` and `worker` docker-compose
  services (same file, different `command` override) — one `apk add poppler-utils` in its `runner`
  stage covers both.

---

## File Structure

**New:**
- `apps/server/src/shared/utils/pdf-text.ts` — `extractPdfText(buffer): Promise<string>`.
- `apps/server/src/shared/utils/__tests__/pdf-text.spec.ts` — real (non-mocked) test.
- `packages/database/prisma/migrations/<timestamp>_add_pgvector_ann_search/migration.sql` —
  extension, 3 columns, 3 HNSW indexes, backfill.
- `apps/server/src/modules/reports/__tests__/reports-attachment-ann.integration.spec.ts`.
- `apps/server/src/modules/rates/__tests__/rates-ann.integration.spec.ts`.
- `apps/server/src/modules/items/__tests__/items-ann.integration.spec.ts`.

**Modified:**
- `apps/server/src/modules/attachments/document-indexing.service.ts` — PDF branch, vector write.
- `apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts` — mock target.
- `apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts` — mock target.
- `apps/server/src/modules/boq/boq.parser.ts` — PDF branch.
- `apps/server/src/modules/tenders/tender-extraction.parser.ts` — PDF branch.
- `apps/server/package.json` — drop `pdf-parse`/`@types/pdf-parse`.
- `apps/server/Dockerfile` — `apk add poppler-utils`.
- `CLAUDE.md` — replace the `pdf-parse` v2 gotcha; document `pdftotext` local-dev prerequisite.
- `docker-compose.yml` — `postgres` image swap.
- `packages/database/prisma/schema.prisma` — `embeddingVector` on 3 models.
- `apps/server/src/modules/reports/reports.repository.ts` — `findNearestAttachments`.
- `apps/server/src/modules/reports/reports.service.ts` — `searchAttachments` calls the new method.
- `apps/server/src/modules/rates/rates.repository.ts` — `setEmbedding` writes vector; `findNearest`.
- `apps/server/src/modules/boq/boq-enrichment.service.ts` — `enrichBoq` calls `findNearest`; `rank()` deleted.
- `apps/server/src/modules/items/items.repository.ts` — `setEmbedding` writes vector; `findNearestConfirmedMatch`.
- `apps/server/src/modules/items/items.service.ts` — `suggestForItem`/`loadClassifyContext` restructured.
- `apps/server/src/modules/items/items.helpers.ts` — `pickConfirmedMatch` simplified; `MatchCandidate` removed.

---

### Task 1: `extractPdfText` shared utility

**Files:**
- Create: `apps/server/src/shared/utils/pdf-text.ts`
- Test: `apps/server/src/shared/utils/__tests__/pdf-text.spec.ts`

**Interfaces:**
- Produces: `extractPdfText(buffer: Buffer): Promise<string>` — resolves with extracted text
  (never rejects on "no text found," only on a real extraction failure: bad PDF, missing binary).
  Used by Tasks 2 and 3.

**Requires `poppler-utils` installed locally** (`brew install poppler` on macOS,
`apt-get install poppler-utils` on Debian/Ubuntu) for this task's test to pass — same class of
local prerequisite as the MinIO test bucket.

- [ ] **Step 1: Write `extractPdfText`**

```ts
import { spawn } from "node:child_process";

/**
 * Extracts text from a PDF buffer via poppler's `pdftotext` CLI (stdin in, stdout out) instead
 * of the `pdf-parse` npm package — pdf-parse@1.1.4's bundled pdf.js throws on real PDFs when
 * loaded through this app's module loaders (tsx in production, Vite in vitest), confirmed with
 * three different PDFs each failing with a different internal pdf.js error, while every one of
 * them extracts correctly via pdftotext and via plain `node -e require("pdf-parse")` (a bundler
 * interaction, not a PDF-content problem). Requires poppler-utils installed on the host/image.
 */
export function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("pdftotext", ["-", "-"]);
    const stdout: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`pdftotext not available: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pdftotext exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });

    child.stdin.write(buffer);
    child.stdin.end();
  });
}
```

- [ ] **Step 2: Write the test**

```ts
import { describe, expect, it } from "vitest";

import { extractPdfText } from "../pdf-text.js";

function buildMinimalPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

describe("extractPdfText", () => {
  it("extracts text from a real minimal PDF via pdftotext", async () => {
    const buffer = buildMinimalPdf("Notice Inviting Tender for XLPE Cable Supply");
    const result = await extractPdfText(buffer);
    expect(result).toContain("Notice Inviting Tender for XLPE Cable Supply");
  });

  it("rejects with a clear error on a non-PDF buffer", async () => {
    await expect(extractPdfText(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @bmp/server exec vitest run src/shared/utils/__tests__/pdf-text.spec.ts`
Expected: PASS (2 tests). If it fails with "pdftotext not available" / `ENOENT`, install
poppler-utils locally first — this is not a code bug.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/shared/utils/pdf-text.ts apps/server/src/shared/utils/__tests__/pdf-text.spec.ts
git commit -m "feat(server): add extractPdfText utility backed by pdftotext"
```

---

### Task 2: Migrate `document-indexing.service.ts` off `pdf-parse`

**Files:**
- Modify: `apps/server/src/modules/attachments/document-indexing.service.ts`
- Modify: `apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts`
- Modify: `apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`

**Interfaces:**
- Consumes: `extractPdfText(buffer): Promise<string>` from Task 1
  (`../../shared/utils/pdf-text.js`).
- Produces: `extractText(buffer, mimeType): Promise<string | null>` — signature and null-on-failure
  contract unchanged; only the PDF branch's implementation changes. Unaffected by this task: DOCX
  branch, `indexAttachment`'s embedding logic (the `embeddingVector` write lands in Task 7).

- [ ] **Step 1: Swap the import and PDF branch**

In `apps/server/src/modules/attachments/document-indexing.service.ts`, replace:

```ts
import pdfParse from "pdf-parse";
```

with:

```ts
import { extractPdfText } from "../../shared/utils/pdf-text.js";
```

and replace the PDF branch inside `extractText`:

```ts
  if (mimeType === "application/pdf") {
    try {
      const data = await pdfParse(buffer);
      return data.text.trim() || null;
    } catch {
      return null;
    }
  }
```

with:

```ts
  if (mimeType === "application/pdf") {
    try {
      const text = await extractPdfText(buffer);
      return text.trim() || null;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 2: Update the unit test's mock target**

In `apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts`, replace:

```ts
const { pdfParseMock } = vi.hoisted(() => ({ pdfParseMock: vi.fn() }));
vi.mock("pdf-parse", () => ({ default: pdfParseMock }));
```

with:

```ts
const { extractPdfTextMock } = vi.hoisted(() => ({ extractPdfTextMock: vi.fn() }));
vi.mock("../../../shared/utils/pdf-text.js", () => ({ extractPdfText: extractPdfTextMock }));
```

and update the three PDF test bodies (the mock now resolves a plain string, not `{ text }`):

```ts
  it("extracts text from a PDF buffer", async () => {
    extractPdfTextMock.mockResolvedValue("Notice Inviting Tender for XLPE Cable Supply");
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBe("Notice Inviting Tender for XLPE Cable Supply");
  });

  it("returns null when pdftotext finds no extractable text", async () => {
    extractPdfTextMock.mockResolvedValue("   ");
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBeNull();
  });

  it("returns null when pdftotext throws", async () => {
    extractPdfTextMock.mockRejectedValue(new Error("corrupt PDF"));
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBeNull();
  });
```

Leave the DOCX and unsupported-mime-type tests exactly as they are.

- [ ] **Step 3: Update the integration test's mock target**

In `apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`,
replace:

```ts
const { embedMock, pdfParseMock } = vi.hoisted(() => ({ embedMock: vi.fn(), pdfParseMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));
vi.mock("pdf-parse", () => ({ default: pdfParseMock }));
```

with:

```ts
const { embedMock, extractPdfTextMock } = vi.hoisted(() => ({ embedMock: vi.fn(), extractPdfTextMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));
vi.mock("../../../shared/utils/pdf-text.js", () => ({ extractPdfText: extractPdfTextMock }));
```

and every `pdfParseMock.mockResolvedValue({ text: "..." })` call in this file becomes
`extractPdfTextMock.mockResolvedValue("...")` (three call sites: `"Notice inviting tender for
cable supply"` twice, `"x".repeat(9000)` once) — same string, just no longer wrapped in `{ text }`.

- [ ] **Step 4: Run both test files**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.spec.ts`
Expected: PASS (5 tests).

Run (requires local Postgres/Redis/MinIO up via `docker compose up -d postgres redis minio minio-init mailhog`
and `.env.test` migrations applied):
`pnpm --filter @bmp/server exec vitest run src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/attachments/document-indexing.service.ts \
  apps/server/src/modules/attachments/__tests__/document-indexing.service.spec.ts \
  apps/server/src/modules/attachments/__tests__/document-indexing.service.integration.spec.ts
git commit -m "fix(attachments): extract PDF text via pdftotext instead of pdf-parse"
```

---

### Task 3: Migrate `boq.parser.ts` and `tender-extraction.parser.ts` off `pdf-parse`

**Files:**
- Modify: `apps/server/src/modules/boq/boq.parser.ts`
- Modify: `apps/server/src/modules/tenders/tender-extraction.parser.ts`

**Interfaces:**
- Consumes: `extractPdfText(buffer): Promise<string>` from Task 1.
- Neither file's own exported function signature changes (`parseBoqFile`, `extractDocumentText`).

Both files currently have no dedicated PDF-branch test (confirmed: neither
`boq.parser.spec.ts`-equivalent nor `tender-extraction.parser.spec.ts`-equivalent exercises the PDF
path with a real buffer — per the spec's Non-goals section, this is a pre-existing gap, not
introduced here) — this task changes only the extraction call, not test coverage.

- [ ] **Step 1: Update `boq.parser.ts`**

Replace:

```ts
import pdfParse from "pdf-parse";
```

with:

```ts
import { extractPdfText } from "../../shared/utils/pdf-text.js";
```

Replace the body of `parsePdfBuffer`:

```ts
async function parsePdfBuffer(buffer: Buffer): Promise<ParsedBoqFile> {
  const data = await pdfParse(buffer);
  const lines = data.text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
```

with:

```ts
async function parsePdfBuffer(buffer: Buffer): Promise<ParsedBoqFile> {
  const text = await extractPdfText(buffer);
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
```

(The rest of the function — building `rows` and the return value — is unchanged.)

- [ ] **Step 2: Update `tender-extraction.parser.ts`**

Replace:

```ts
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

import { BadRequestError } from "../../core/errors/HttpErrors.js";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;
}
```

with:

```ts
import mammoth from "mammoth";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { extractPdfText } from "../../shared/utils/pdf-text.js";
```

(The local `extractPdfText` function is deleted entirely — the imported one has the identical
name and signature, so the one call site in `extractDocumentText`, `text = await
extractPdfText(buffer);`, needs no further change.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no new errors (both files still export the same public functions with the same types).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/boq/boq.parser.ts apps/server/src/modules/tenders/tender-extraction.parser.ts
git commit -m "fix(boq,tenders): extract PDF text via pdftotext instead of pdf-parse"
```

---

### Task 4: Remove `pdf-parse` dependency; Dockerfile and CLAUDE.md updates

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/Dockerfile`
- Modify: `CLAUDE.md`

**Interfaces:** None — this task removes a now-unused dependency and updates deployment/docs. Runs
after Tasks 2 and 3 so no source file still imports `pdf-parse`.

- [ ] **Step 1: Verify nothing still imports `pdf-parse`**

Run: `grep -rl "pdf-parse" apps/server/src`
Expected: no output (empty). If anything prints, stop — a call site from Tasks 2/3 was missed;
fix it before continuing.

- [ ] **Step 2: Remove the dependency**

In `apps/server/package.json`, delete these two lines:

```json
    "pdf-parse": "^1.1.4",
```

```json
    "@types/pdf-parse": "^1.1.5",
```

Then run: `pnpm install`
Expected: lockfile updates, `pdf-parse` removed from `node_modules` and `pnpm-lock.yaml`.

- [ ] **Step 3: Add `poppler-utils` to the Dockerfile's runner stage**

In `apps/server/Dockerfile`, in the `runner` stage, add this line immediately before `USER bmp`:

```dockerfile
RUN apk add --no-cache poppler-utils
```

- [ ] **Step 4: Update CLAUDE.md's gotcha**

Replace this existing gotcha entry:

```
- `pdf-parse` v2 is a heavy pdfjs-based rewrite (canvas/worker deps) with a different class API;
  we deliberately pinned `pdf-parse@1.1.4` (simple `pdfParse(buffer) -> {text}`) since BOQ PDF
  extraction is explicitly best-effort — don't "helpfully" upgrade it.
```

with:

```
- PDF text extraction (`shared/utils/pdf-text.ts#extractPdfText`) shells out to poppler's
  `pdftotext` CLI, not any npm PDF library — `pdf-parse@1.1.4`'s bundled pdf.js build was confirmed
  broken under both `tsx` (production) and vitest, throwing on real PDFs with genuine embedded
  text (three different PDFs, three different internal pdf.js errors), while the identical bytes
  parse fine via plain `node -e require("pdf-parse")` — a loader/bundling incompatibility, not a
  content problem. `pdftotext` sidesteps it entirely since it's a subprocess call, not a Node
  module. Requires `poppler-utils` installed wherever the server/worker actually run: `brew install
  poppler` locally, `apk add poppler-utils` in `apps/server/Dockerfile`'s runner stage (already
  done). If PDF content search / BOQ PDF upload / tender-extraction-from-PDF suddenly all return
  empty text, check `pdftotext` is on `PATH` before suspecting the code.
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @bmp/server exec vitest run`
Expected: PASS, no `pdf-parse`-related failures.

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/Dockerfile CLAUDE.md
git commit -m "chore(server): remove pdf-parse dependency, install poppler-utils in Docker"
```

---

### Task 5: `docker-compose.yml` postgres image swap

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:** None — infra-only change. Must land before Task 6 (the migration needs
`CREATE EXTENSION vector` to succeed, which requires the pgvector-enabled image).

- [ ] **Step 1: Swap the image**

In `docker-compose.yml`, in the `postgres` service, replace:

```yaml
    image: postgres:16-alpine
```

with:

```yaml
    image: pgvector/pgvector:pg16
```

- [ ] **Step 2: Manually verify the swap against the existing dev volume**

No automated test — this step is a manual check, run once during this task and reported in the
implementer's report, not repeated by CI:

```bash
docker compose up -d postgres
docker compose ps postgres
docker compose exec postgres psql -U bmp -d bmp -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname FROM pg_extension WHERE extname = 'vector';"
```

Expected: the container starts healthy against the existing `pgdata` volume (no data loss, no
migration/dump needed — same Postgres 16 core and on-disk format), and the `SELECT` returns one row
(`vector`). If the container fails to start or the extension can't be created, stop and report —
do not proceed to Task 6 until this passes.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(infra): swap postgres image to pgvector/pgvector:pg16"
```

---

### Task 6: Schema + migration for `embeddingVector` on Attachment, HistoricalRate, Item

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_add_pgvector_ann_search/migration.sql`

**Interfaces:**
- Produces: an `embeddingVector` column (Postgres type `vector(1024)`) on `attachments`,
  `historical_rates`, `items`, each with an HNSW `vector_cosine_ops` index, populated for any row
  that already has `embeddedAt IS NOT NULL`. Consumed by Tasks 7 (write side) and 8/9/10 (read
  side).

1024 is bge-m3's real embedding dimension (`OLLAMA_EMBED_MODEL` default), verified live against a
running Ollama instance — not a guess. If `OLLAMA_EMBED_MODEL` is ever changed to a
different-dimension model, this column needs a fresh migration (out of scope here — see spec's
Non-goals).

- [ ] **Step 1: Add `embeddingVector` to the three models**

In `packages/database/prisma/schema.prisma`, in `model Attachment`, change:

```prisma
  extractedText String?
  embedding     Float[]
  embeddedAt    DateTime?
```

to:

```prisma
  extractedText String?
  embedding     Float[]
  embeddedAt    DateTime?
  // pgvector column kept in sync with `embedding` on every write — see
  // docs/superpowers/specs/2026-08-28-pdf-extraction-and-ann-search-design.md. `Float[]` above
  // stays for now; this column is what ANN reads actually query.
  embeddingVector Unsupported("vector(1024)")?
```

In `model HistoricalRate`, change:

```prisma
  embedding  Float[]
  embeddedAt DateTime?
```

to:

```prisma
  embedding  Float[]
  embeddedAt DateTime?
  embeddingVector Unsupported("vector(1024)")?
```

In `model Item`, change:

```prisma
  embedding  Float[]
  embeddedAt DateTime?
```

to:

```prisma
  embedding  Float[]
  embeddedAt DateTime?
  embeddingVector Unsupported("vector(1024)")?
```

- [ ] **Step 2: Generate an empty migration shell**

Run (from repo root, against the dev database):

```bash
dotenv -e .env -- pnpm --filter @bmp/database exec prisma migrate dev --create-only --name add_pgvector_ann_search
```

This creates `packages/database/prisma/migrations/<timestamp>_add_pgvector_ann_search/migration.sql`
with Prisma's best-effort guess at the DDL. Prisma cannot correctly infer HNSW index or backfill
SQL for `Unsupported` types — **replace the entire generated file's contents** with the hand-written
SQL in Step 3, rather than editing Prisma's guess.

- [ ] **Step 3: Write the migration SQL**

Replace the full contents of the generated `migration.sql` with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "attachments" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "attachments_embeddingVector_hnsw_idx" ON "attachments"
  USING hnsw ("embeddingVector" vector_cosine_ops);

ALTER TABLE "historical_rates" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "historical_rates_embeddingVector_hnsw_idx" ON "historical_rates"
  USING hnsw ("embeddingVector" vector_cosine_ops);

ALTER TABLE "items" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "items_embeddingVector_hnsw_idx" ON "items"
  USING hnsw ("embeddingVector" vector_cosine_ops);

-- One-time backfill: copy any existing Float[] embeddings into the new column so already-embedded
-- rows aren't invisible to ANN search after cutover.
UPDATE "attachments" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
UPDATE "historical_rates" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
UPDATE "items" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
```

- [ ] **Step 4: Apply to the dev database and regenerate the client**

```bash
dotenv -e .env -- pnpm --filter @bmp/database exec prisma migrate dev
pnpm db:generate
```

Expected: migration applies cleanly (it was already run via `--create-only` + manual edit, this
step marks it applied in `_prisma_migrations` and regenerates `packages/database/generated/client`
so `Prisma.sql`/`$queryRaw`/`$executeRaw` typings pick up the new column). Per CLAUDE.md's gotcha on
this exact failure mode, `pnpm db:generate` is required — `prisma migrate dev` alone does not
guarantee the generated client's types are current for a hand-edited migration.

- [ ] **Step 5: Apply to the test database**

```bash
dotenv -e .env.test -- pnpm --filter @bmp/database exec prisma migrate deploy
```

Expected: the same migration applies to `bmp_test` (pgvector extension is per-database — this step
is required even though both databases share one Postgres server/image).

- [ ] **Step 6: Verify**

```bash
docker compose exec postgres psql -U bmp -d bmp -c "\d+ attachments" | grep embeddingVector
docker compose exec postgres psql -U bmp -d bmp_test -c "\d+ items" | grep embeddingVector
```

Expected: both print a line showing the `embeddingVector` column with type `vector`.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(database): add pgvector embeddingVector column to Attachment, HistoricalRate, Item"
```

---

### Task 7: Write-side sync — `embeddingVector` at all three `setEmbedding` sites

**Files:**
- Modify: `apps/server/src/modules/attachments/document-indexing.service.ts`
- Modify: `apps/server/src/modules/rates/rates.repository.ts`
- Modify: `apps/server/src/modules/items/items.repository.ts`

**Interfaces:**
- No signature changes to any of the three write functions
  (`indexAttachment`, `IHistoricalRatesRepository#setEmbedding`, `IItemsRepository#setEmbedding`) —
  each just performs one additional `$executeRaw` after its existing Prisma write, using the same
  `PrismaClient` instance already in scope (`prisma` singleton in `document-indexing.service.ts`,
  `this.prisma` in the two repository classes).
- Vector literal convention used everywhere in this plan: `` `[${embedding.join(",")}]` `` cast via
  `::vector` — embeddings are always `number[]`, so no string-escaping is needed for the values
  themselves; the literal string is still passed as a bound parameter through the tagged-template
  `$executeRaw`/`$queryRaw`, never concatenated into SQL text.

- [ ] **Step 1: `document-indexing.service.ts#indexAttachment`**

Replace the success branch:

```ts
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { extractedText: truncated, embedding: vector, embeddedAt: new Date() },
    });
```

with:

```ts
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { extractedText: truncated, embedding: vector, embeddedAt: new Date() },
    });
    const vectorLiteral = `[${vector.join(",")}]`;
    await prisma.$executeRaw`UPDATE attachments SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${attachmentId}`;
```

(The Ollama-down degraded branch, which stores `extractedText` with no embedding, is unchanged —
there is no vector to write yet.)

- [ ] **Step 2: `rates.repository.ts#setEmbedding`**

Replace:

```ts
  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.prisma.historicalRate.update({
      where: { id },
      data: { embedding, embeddedAt: new Date() },
    });
  }
```

with:

```ts
  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.prisma.historicalRate.update({
      where: { id },
      data: { embedding, embeddedAt: new Date() },
    });
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$executeRaw`UPDATE historical_rates SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
  }
```

- [ ] **Step 3: `items.repository.ts#setEmbedding`**

Replace:

```ts
  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.prisma.item.update({ where: { id }, data: { embedding, embeddedAt: new Date() } });
  }
```

with:

```ts
  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.prisma.item.update({ where: { id }, data: { embedding, embeddedAt: new Date() } });
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$executeRaw`UPDATE items SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
  }
```

- [ ] **Step 4: Run existing unit and integration tests for all three modules**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/attachments src/modules/rates src/modules/items`
Expected: PASS — these existing tests assert on `embedding`/`embeddedAt`, not `embeddingVector`,
so no assertion changes are needed here; this step only confirms the extra raw write doesn't throw
or break existing behavior. (Integration tests require Postgres/Redis/MinIO up and Task 6's
migration applied to `bmp_test`.)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/attachments/document-indexing.service.ts \
  apps/server/src/modules/rates/rates.repository.ts \
  apps/server/src/modules/items/items.repository.ts
git commit -m "feat(server): sync embeddingVector column on every embedding write"
```

---

### Task 8: Attachment ANN read path (`reports.repository.ts` / `reports.service.ts`)

**Files:**
- Modify: `apps/server/src/modules/reports/reports.repository.ts`
- Modify: `apps/server/src/modules/reports/reports.service.ts`
- Modify: `apps/server/src/modules/reports/__tests__/reports.service.spec.ts`
- Create: `apps/server/src/modules/reports/__tests__/reports-attachment-ann.integration.spec.ts`

**Interfaces:**
- Produces: `IReportsRepository#findNearestAttachments(tenderIds: string[], queryVector: number[],
  limit: number, threshold: number): Promise<(AttachmentMetadataRow & { similarity: number })[]>`.
- Consumes: `AttachmentMetadataRow` (already defined in `reports.repository.ts`: `{ id,
  originalName, documentType, entityId }`).
- `findEmbeddedAttachments` is removed from `IReportsRepository` — its only production caller is
  `reports.service.ts#searchAttachments` (confirmed). `EmbeddedAttachmentRow` stays exported
  (unlike `findEmbeddedAttachments`, which becomes dead): `reports.service.spec.ts`'s
  `FakeReportsRepository implements IReportsRepository` uses it as its content-match fixture shape,
  same treatment as `HistoricalRateVector` in Task 9.

- [ ] **Step 1: Add `findNearestAttachments`, remove `findEmbeddedAttachments`**

In `apps/server/src/modules/reports/reports.repository.ts`, delete the `findEmbeddedAttachments`
method (and its entry in `IReportsRepository`) — leave the `EmbeddedAttachmentRow` interface
declaration in place, it's still used as a test fixture type (Step 3 below):

```ts
  findEmbeddedAttachments(tenderIds: string[]): Promise<EmbeddedAttachmentRow[]>;
```

```ts
  async findEmbeddedAttachments(tenderIds: string[]): Promise<EmbeddedAttachmentRow[]> {
    if (tenderIds.length === 0) return [];
    const rows = await this.prisma.attachment.findMany({
      where: {
        entityType: "Tender",
        entityId: { in: tenderIds },
        variant: "ORIGINAL",
        embeddedAt: { not: null },
      },
      select: { id: true, originalName: true, documentType: true, entityId: true, embedding: true },
    });
    return rows.map((row) => ({ ...row, entityId: row.entityId! }));
  }
```

Add, in their place (interface entry in `IReportsRepository`):

```ts
  findNearestAttachments(
    tenderIds: string[],
    queryVector: number[],
    limit: number,
    threshold: number,
  ): Promise<(AttachmentMetadataRow & { similarity: number })[]>;
```

and the implementation:

```ts
  async findNearestAttachments(
    tenderIds: string[],
    queryVector: number[],
    limit: number,
    threshold: number,
  ): Promise<(AttachmentMetadataRow & { similarity: number })[]> {
    if (tenderIds.length === 0) return [];
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "originalName", "documentType", "entityId",
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM attachments
      WHERE "entityType" = 'Tender' AND "entityId" = ANY(${tenderIds})
        AND variant = 'ORIGINAL' AND "embeddingVector" IS NOT NULL
        AND 1 - ("embeddingVector" <=> ${vectorLiteral}::vector) >= ${threshold}
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
```

- [ ] **Step 2: Update `reports.service.ts#searchAttachments`**

Replace:

```ts
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
          if (!(err instanceof ServiceUnavailableError)) throw err;
        }
      }
```

with:

```ts
      const [metadataMatches, contentMatches] = await Promise.all([
        this.reportsRepository.searchAttachmentsByMetadata(tenderIds, query),
        this.findContentMatches(tenderIds, query),
      ]);
```

and add a new private method on the same class:

```ts
  private async findContentMatches(
    tenderIds: string[],
    query: string,
  ): Promise<AttachmentMetadataRow[]> {
    try {
      const [queryVector] = await embed([query]);
      if (!queryVector) return [];
      return this.reportsRepository.findNearestAttachments(tenderIds, queryVector, 5, env.DOCUMENT_MATCH_THRESHOLD);
    } catch (err) {
      if (err instanceof ServiceUnavailableError) return [];
      throw err;
    }
  }
```

(`5` matches the existing `.slice(0, 5)` cap already applied a few lines below in `searchAttachments`
— the ANN query now enforces that cap in SQL via `LIMIT` instead of after the fact.)

`cosineSimilarity` is imported on the same line as `round2` (`import { cosineSimilarity, round2 }
from "../../shared/utils/math.js";`), and `round2` has many other call sites in this file (its
report-percentage/total calculations) — do not delete the whole import line. Replace:

```ts
import { cosineSimilarity, round2 } from "../../shared/utils/math.js";
```

with:

```ts
import { round2 } from "../../shared/utils/math.js";
```

- [ ] **Step 3: Update `reports.service.spec.ts`'s fake repository**

`FakeReportsRepository implements IReportsRepository` (`apps/server/src/modules/reports/__tests__/
reports.service.spec.ts`) has an `embeddedAttachments: EmbeddedAttachmentRow[]` fixture array and a
`findEmbeddedAttachments` method the interface no longer declares. Three existing tests
("includes a content-matched attachment...", "excludes a content match below threshold...",
"dedupes an attachment that matches both...") set `repository.embeddedAttachments` and rely on
`searchAttachments` doing the cosine-rank-and-threshold-filter — that logic is moving into
`findNearestAttachments`, so the fake needs to do it instead, in-memory, to keep simulating what
the real SQL would return.

Add this import:

```ts
import { cosineSimilarity } from "../../../shared/utils/math.js";
```

Replace the fake's `findEmbeddedAttachments` method:

```ts
  async findEmbeddedAttachments(_tenderIds: string[]) {
    return this.embeddedAttachments;
  }
```

with:

```ts
  async findNearestAttachments(_tenderIds: string[], queryVector: number[], limit: number, threshold: number) {
    return this.embeddedAttachments
      .map((row) => ({ ...row, similarity: cosineSimilarity(queryVector, row.embedding) }))
      .filter((row) => row.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
```

No other line in any of the three existing test bodies needs to change — they only ever set
`repository.embeddedAttachments = [...]` and assert on `result.results`, both untouched by this
swap.

- [ ] **Step 4: Write the integration test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ReportsRepository } from "../reports.repository.js";

describe("findNearestAttachments (integration)", () => {
  const repository = new ReportsRepository(prisma);
  let businessId: string;
  let userId: string;
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
    const organization = await prisma.organization.create({
      data: { id: randomUUID(), name: "ANN Test Client", type: "PRIVATE", businessId },
    });
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
    await prisma.organization.deleteMany({ where: { businessId } });
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
```

- [ ] **Step 5: Run the new test and the existing reports test suite**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports`
Expected: PASS, including the two new ANN integration tests and the updated
`reports.service.spec.ts` (fake repository, all existing assertions unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/reports
git commit -m "feat(reports): replace brute-force attachment content search with pgvector ANN"
```

---

### Task 9: HistoricalRate ANN read path (`rates.repository.ts` / `boq-enrichment.service.ts`)

**Files:**
- Modify: `apps/server/src/modules/rates/rates.repository.ts`
- Modify: `apps/server/src/modules/boq/boq-enrichment.service.ts`
- Modify: `apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts`
- Create: `apps/server/src/modules/rates/__tests__/rates-ann.integration.spec.ts`

**Interfaces:**
- Produces: a new flat `HistoricalRateMatch` interface (`{ id, itemName, unit, rate, category,
  similarity }`) exported from `rates.repository.ts`, and
  `IHistoricalRatesRepository#findNearest(businessId: string, queryVector: number[], limit:
  number): Promise<HistoricalRateMatch[]>` — no threshold filter in SQL; `classify()` in
  `boq-enrichment.service.ts` already applies `AI_MATCH_THRESHOLD` to `matches[0]` and
  `AI_CONTEXT_FLOOR` to the rest, downstream, unchanged.
- The existing `Match` interface in `boq-enrichment.service.ts` was a *nested* shape (`{ rate:
  HistoricalRateVector; similarity: number }`, so callers read `best.rate.itemName`) because
  `rank()` built it from a full `HistoricalRateVector` (which also carries `embedding`). An ANN
  query naturally returns flat rows with no `embedding` column, so `Match` is deleted and every
  `.rate.x` access in `classify()`/`buildPrompt()` becomes a flat `.x` access on
  `HistoricalRateMatch` — this is a real signature change, not just a call-site swap.
- `findEmbedded` and `HistoricalRateVector` become fully dead once this task lands (confirmed via
  `grep -rn "findEmbedded\b" apps/server/src` and `grep -rn "HistoricalRateVector" apps/server/src`
  before writing this task — the only production callers are `rank()`, deleted below, and
  `enrichBoq`'s `findEmbedded(businessId)` call, replaced below) **except** the test fixture in
  Step 4 below, which keeps using `HistoricalRateVector` as its embedded-rate fixture shape — leave
  the interface exported, remove only `findEmbedded` from the interface and implementation.
- A new `RATE_MATCH_CANDIDATES` constant in `boq-enrichment.service.ts` (set to 10) replaces the
  "all rates for the business" list `rank()` used to sort — 10 is comfortably more than
  `LLM_CONTEXT_CANDIDATES` (3), so every downstream filter still has enough candidates to draw from.

- [ ] **Step 1: Add `HistoricalRateMatch` and `findNearest` to `rates.repository.ts`; remove `findEmbedded`**

Add this new interface near `HistoricalRateVector`:

```ts
/** A ranked ANN result — flat, no `embedding` column, since nothing downstream needs the vector. */
export interface HistoricalRateMatch {
  id: string;
  itemName: string;
  unit: string;
  rate: number;
  category: HistoricalRateCategory;
  similarity: number;
}
```

Remove `findEmbedded` from `IHistoricalRatesRepository`:

```ts
  findEmbedded(businessId: string): Promise<HistoricalRateVector[]>;
```

and add in its place:

```ts
  findNearest(businessId: string, queryVector: number[], limit: number): Promise<HistoricalRateMatch[]>;
```

Remove the `findEmbedded` implementation:

```ts
  findEmbedded(businessId: string): Promise<HistoricalRateVector[]> {
    return this.prisma.historicalRate.findMany({
      where: { businessId, embeddedAt: { not: null } },
      select: { id: true, itemName: true, unit: true, rate: true, category: true, embedding: true },
    });
  }
```

and add the ANN implementation:

```ts
  findNearest(
    businessId: string,
    queryVector: number[],
    limit: number,
  ): Promise<HistoricalRateMatch[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "itemName", unit, rate, category,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM historical_rates
      WHERE "businessId" = ${businessId} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
```

- [ ] **Step 2: Update `boq-enrichment.service.ts` — flatten `Match`, delete `rank()`**

Replace the `Match` interface and its import:

```ts
import type {
  HistoricalRateVector,
  IHistoricalRatesRepository,
} from "../rates/rates.repository.js";
```

```ts
interface Match {
  rate: HistoricalRateVector;
  similarity: number;
}
```

with:

```ts
import type {
  HistoricalRateMatch,
  IHistoricalRatesRepository,
} from "../rates/rates.repository.js";
```

(the local `Match` interface is deleted — `HistoricalRateMatch` from the repository is used
directly everywhere `Match` was.)

Delete the `rank` method entirely:

```ts
  private rank(itemVector: number[], rates: HistoricalRateVector[]): Match[] {
    return rates
      .map((rate) => ({ rate, similarity: cosineSimilarity(itemVector, rate.embedding) }))
      .sort((a, b) => b.similarity - a.similarity);
  }
```

Update `buildPrompt` to read flat fields instead of `.rate.x`:

```ts
function buildPrompt(description: string, unit: string | null, candidates: Match[]): string {
  const context = candidates.length
    ? candidates.map((c) => `  - "${c.rate.itemName}" (category: ${c.rate.category})`).join("\n")
    : "  (none)";
```

becomes:

```ts
function buildPrompt(description: string, unit: string | null, candidates: HistoricalRateMatch[]): string {
  const context = candidates.length
    ? candidates.map((c) => `  - "${c.itemName}" (category: ${c.category})`).join("\n")
    : "  (none)";
```

Update `classify` to read flat fields instead of `.rate.x`:

```ts
  private async classify(
    description: string,
    unit: string | null,
    matches: Match[],
  ): Promise<UpdateBoqItemEnrichmentData> {
    const best = matches[0];

    // A rate is only ever suggested when this is provably the SAME item: near-exact wording,
    // identical numeric specs, and the same unit. All three are required — see sameSpec()
    // above for why neither the embedding nor the LLM is trusted with this call.
    const matched =
      best !== undefined &&
      best.similarity >= env.AI_MATCH_THRESHOLD &&
      sameSpec(description, best.rate.itemName) &&
      (unit === null || best.rate.unit === unit)
        ? best
        : null;

    // The LLM always classifies, even when a rate matched. HistoricalRate.category is a
    // cost-type (MATERIAL/LABOR/...), not a trade, so it cannot fill aiCategory — reusing it
    // would make aiCategory mean "Electrical" on one row and "MATERIAL" on the next. The
    // model is only asked what it's measurably good at (naming and categorising); pricing
    // stays with the deterministic check above.
    const raw = await generateJson(
      buildPrompt(
        description,
        unit,
        matches.filter((m) => m.similarity >= env.AI_CONTEXT_FLOOR).slice(0, LLM_CONTEXT_CANDIDATES),
      ),
      env.OLLAMA_ENRICHMENT_MODEL,
    );
    const parsed = parseClassification(raw);
    if (!parsed) throw new ServiceUnavailableError("Ollama returned an unusable classification.");

    return {
      normalizedName: matched ? matched.rate.itemName : parsed.normalizedName,
      aiCategory: parsed.category,
      aiSubcategory: parsed.subcategory,
      // A matched rate is backed by a measured near-exact match; a classification is only the
      // model's own say-so, so it never scores as high.
      aiConfidence: matched
        ? round2(matched.similarity)
        : round2(Math.min(parsed.confidence, LLM_CONFIDENCE_CEILING)),
      suggestedRate: matched?.rate.rate ?? null,
      aiSource: matched ? "historical" : "llm",
      aiRateSourceId: matched?.rate.id ?? null,
      aiEnrichedAt: new Date(),
    };
  }
```

becomes:

```ts
  private async classify(
    description: string,
    unit: string | null,
    matches: HistoricalRateMatch[],
  ): Promise<UpdateBoqItemEnrichmentData> {
    const best = matches[0];

    // A rate is only ever suggested when this is provably the SAME item: near-exact wording,
    // identical numeric specs, and the same unit. All three are required — see sameSpec()
    // above for why neither the embedding nor the LLM is trusted with this call.
    const matched =
      best !== undefined &&
      best.similarity >= env.AI_MATCH_THRESHOLD &&
      sameSpec(description, best.itemName) &&
      (unit === null || best.unit === unit)
        ? best
        : null;

    // The LLM always classifies, even when a rate matched. HistoricalRate.category is a
    // cost-type (MATERIAL/LABOR/...), not a trade, so it cannot fill aiCategory — reusing it
    // would make aiCategory mean "Electrical" on one row and "MATERIAL" on the next. The
    // model is only asked what it's measurably good at (naming and categorising); pricing
    // stays with the deterministic check above.
    const raw = await generateJson(
      buildPrompt(
        description,
        unit,
        matches.filter((m) => m.similarity >= env.AI_CONTEXT_FLOOR).slice(0, LLM_CONTEXT_CANDIDATES),
      ),
      env.OLLAMA_ENRICHMENT_MODEL,
    );
    const parsed = parseClassification(raw);
    if (!parsed) throw new ServiceUnavailableError("Ollama returned an unusable classification.");

    return {
      normalizedName: matched ? matched.itemName : parsed.normalizedName,
      aiCategory: parsed.category,
      aiSubcategory: parsed.subcategory,
      // A matched rate is backed by a measured near-exact match; a classification is only the
      // model's own say-so, so it never scores as high.
      aiConfidence: matched
        ? round2(matched.similarity)
        : round2(Math.min(parsed.confidence, LLM_CONFIDENCE_CEILING)),
      suggestedRate: matched?.rate ?? null,
      aiSource: matched ? "historical" : "llm",
      aiRateSourceId: matched?.id ?? null,
      aiEnrichedAt: new Date(),
    };
  }
```

Add a module-level constant near `LLM_CONTEXT_CANDIDATES`:

```ts
/** How many nearest historical rates the ANN query returns per item, before threshold filtering. */
const RATE_MATCH_CANDIDATES = 10;
```

Replace `enrichBoq`:

```ts
  async enrichBoq(boqId: string, businessId: string): Promise<void> {
    const items = await this.boqRepository.findItemsByBoqId(boqId);
    // Section headers carry no rate and nothing to match on.
    const leaves = items.filter((item) => item.quantity !== null || item.rate !== null);
    if (leaves.length === 0) return;

    await this.embedPendingRates(businessId);
    const rates = await this.ratesRepository.findEmbedded(businessId);
    const itemVectors = await embed(leaves.map((item) => item.description));

    let enriched = 0;
    for (const [index, item] of leaves.entries()) {
      const vector = itemVectors[index];
      if (!vector) continue;

      // One bad item (unusable LLM output) must not abandon the rest of the BOQ.
      try {
        const enrichment = await this.classify(item.description, item.unit, this.rank(vector, rates));
        await this.boqRepository.updateItemEnrichment(item.id, enrichment);
        enriched += 1;
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err;
        logger.warn({ itemId: item.id, err }, "Skipped BOQ item enrichment");
      }
    }

    logger.info({ boqId, enriched, total: leaves.length }, "BOQ enrichment complete");
  }
```

with:

```ts
  async enrichBoq(boqId: string, businessId: string): Promise<void> {
    const items = await this.boqRepository.findItemsByBoqId(boqId);
    // Section headers carry no rate and nothing to match on.
    const leaves = items.filter((item) => item.quantity !== null || item.rate !== null);
    if (leaves.length === 0) return;

    await this.embedPendingRates(businessId);
    const itemVectors = await embed(leaves.map((item) => item.description));

    let enriched = 0;
    for (const [index, item] of leaves.entries()) {
      const vector = itemVectors[index];
      if (!vector) continue;

      // One bad item (unusable LLM output) must not abandon the rest of the BOQ.
      try {
        const matches = await this.ratesRepository.findNearest(businessId, vector, RATE_MATCH_CANDIDATES);
        const enrichment = await this.classify(item.description, item.unit, matches);
        await this.boqRepository.updateItemEnrichment(item.id, enrichment);
        enriched += 1;
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err;
        logger.warn({ itemId: item.id, err }, "Skipped BOQ item enrichment");
      }
    }

    logger.info({ boqId, enriched, total: leaves.length }, "BOQ enrichment complete");
  }
```

`cosineSimilarity` was only ever used inside `rank()` in this file (confirmed — nowhere else in
`boq-enrichment.service.ts` calls it), so it's now fully dead in production code here. It shares an
import line with `round2`, which has many other call sites in `classify()` — don't delete the whole
line. Replace:

```ts
import { cosineSimilarity, round2 } from "../../shared/utils/math.js";
```

with:

```ts
import { round2 } from "../../shared/utils/math.js";
```

(Step 3 below adds a *separate* import of `cosineSimilarity` inside the test file's fake
repository — a fake computing cosine in-memory to simulate what the real ANN query returns is a
normal test-double pattern, unrelated to whether the production file still needs it.)

- [ ] **Step 3: Update `boq-enrichment.service.spec.ts`'s fake repository**

This existing test file (`apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts`)
has a `FakeRatesRepository implements Partial<IHistoricalRatesRepository>` whose `embedded:
HistoricalRateVector[]` fixture array and `findEmbedded()` method the 9 existing tests all rely on
(via `ratesRepository.embedded = [...]`). Since `enrichBoq` now calls `findNearest` instead, the
fake needs a `findNearest` that reproduces the same ranking `rank()` used to do — in-memory cosine
similarity over the fixture array — so every existing test's `ratesRepository.embedded = [...]`
setup keeps working unchanged.

Add this import:

```ts
import { cosineSimilarity } from "../../../shared/utils/math.js";
```

Add `HistoricalRateMatch` to the existing type-only import from `rates.repository.js` (alongside
`HistoricalRateVector`, which stays — it's still the fixture shape for `embedded`):

```ts
import type {
  CreateHistoricalRateData,
  HistoricalRateMatch,
  HistoricalRateVector,
  HistoricalRateWithCreator,
  IHistoricalRatesRepository,
  ListHistoricalRatesFilters,
} from "../../rates/rates.repository.js";
```

Remove the fake's `findEmbedded` method:

```ts
  async findEmbedded(): Promise<HistoricalRateVector[]> {
    return this.embedded;
  }
```

and replace it with:

```ts
  async findNearest(_businessId: string, queryVector: number[], limit: number): Promise<HistoricalRateMatch[]> {
    return this.embedded
      .map((rate) => ({
        id: rate.id,
        itemName: rate.itemName,
        unit: rate.unit,
        rate: rate.rate,
        category: rate.category,
        similarity: cosineSimilarity(queryVector, rate.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
```

None of the 9 existing test bodies need any other change — they only ever set `ratesRepository.
embedded = [...]` and assert on `boqRepository.enrichment`, both untouched by this swap.

- [ ] **Step 4: Write the integration test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HistoricalRatesRepository } from "../rates.repository.js";

describe("findNearest (HistoricalRate ANN, integration)", () => {
  const repository = new HistoricalRatesRepository(prisma);
  let businessId: string;
  let userId: string;
  const rateIds: string[] = [];

  async function insertEmbeddedRate(itemName: string, vector: number[]): Promise<string> {
    const id = randomUUID();
    await prisma.historicalRate.create({
      data: {
        id,
        businessId,
        category: "MATERIAL",
        itemName,
        unit: "nos",
        rate: 100,
        effectiveDate: new Date(),
        createdById: userId,
        embedding: vector,
        embeddedAt: new Date(),
      },
    });
    const vectorLiteral = `[${vector.join(",")}]`;
    await prisma.$executeRaw`UPDATE historical_rates SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
    rateIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "ANN Rate Test Business", code: `ANNR${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `ann-rate-${randomUUID()}@example.com`,
        passwordHash: "not-a-real-hash",
        firstName: "Ann",
        lastName: "Tester",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { id: { in: rateIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("ranks nearest rate first, ordered by descending similarity", async () => {
    const dims = 1024;
    const near = new Array(dims).fill(0);
    near[0] = 1;
    const mid = new Array(dims).fill(0);
    mid[0] = 0.9;
    mid[1] = Math.sqrt(1 - 0.81);
    const far = new Array(dims).fill(0);
    far[1] = 1;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    await insertEmbeddedRate("XLPE Cable 4C x16", near);
    await insertEmbeddedRate("XLPE Cable 4C x25", mid);
    await insertEmbeddedRate("PVC Pipe 100mm", far);

    const results = await repository.findNearest(businessId, query, 10);

    expect(results).toHaveLength(3);
    expect(results[0]?.itemName).toBe("XLPE Cable 4C x16");
    expect(results[0]?.similarity).toBeCloseTo(1, 5);
    expect(results[2]?.itemName).toBe("PVC Pipe 100mm");
  });

  it("scopes results to the given business", async () => {
    const otherBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Other ANN Business", code: `OTHR${randomUUID().slice(0, 8)}` },
    });
    const dims = 1024;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    const results = await repository.findNearest(otherBusiness.id, query, 10);
    expect(results).toHaveLength(0);

    await prisma.business.deleteMany({ where: { id: otherBusiness.id } });
  });
});
```

- [ ] **Step 5: Run the new test and the existing rates/boq test suites**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/rates src/modules/boq`
Expected: PASS, including the new ANN integration test and the 9 existing
`boq-enrichment.service.spec.ts` tests against the updated fake repository.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/rates apps/server/src/modules/boq
git commit -m "feat(rates,boq): replace brute-force historical-rate matching with pgvector ANN"
```

(this covers the modified `boq-enrichment.service.spec.ts` too — it lives under `apps/server/src/
modules/boq`.)

---

### Task 10: Item ANN read path (`items.repository.ts` / `items.service.ts` / `items.helpers.ts`)

**Files:**
- Modify: `apps/server/src/modules/items/items.repository.ts`
- Modify: `apps/server/src/modules/items/items.service.ts`
- Modify: `apps/server/src/modules/items/items.helpers.ts`
- Modify: `apps/server/src/modules/items/__tests__/items.helpers.spec.ts`
- Create: `apps/server/src/modules/items/__tests__/items-ann.integration.spec.ts`

**Interfaces:**
- Produces: a new flat `NearestConfirmedMatch` interface (`{ id, categoryId, canonicalName, unit,
  similarity }` — deliberately not `ConfirmedMatchRow & { similarity }`, since `ConfirmedMatchRow`
  carries `embedding`/`embeddedAt` fields this ANN row will never have) and
  `IItemsRepository#findNearestConfirmedMatch(businessId: string, excludeItemId: string,
  queryVector: number[], limit: number): Promise<NearestConfirmedMatch[]>` — no threshold filter in
  SQL (unlike Task 8's Attachment query): this one result set feeds *two* downstream consumers with
  different needs (a single-best threshold check, and an unfiltered top-N list for LLM few-shot
  grounding).
- `pickConfirmedMatch`'s signature changes: it now takes a single best candidate (or `null`)
  instead of a candidate array, and no longer takes `target.embedding` (the caller already knows
  whether an ANN query ran). `MatchCandidate` is deleted — nothing builds it anymore.
- `findConfirmedForMatch` and `ConfirmedMatchRow` are **not** removed — `loadClassifyContext` still
  uses `findConfirmedForMatch` for the unrelated "embed any confirmed item missing an embedding"
  convergence step, just no longer to build a matching candidate pool.

- [ ] **Step 1: Add `NearestConfirmedMatch` and `findNearestConfirmedMatch` to `items.repository.ts`**

Add this new interface near `ConfirmedMatchRow`:

```ts
/** A ranked ANN result — flat, no `embedding`/`embeddedAt`, since nothing downstream needs them. */
export interface NearestConfirmedMatch {
  id: string;
  categoryId: string;
  canonicalName: string;
  unit: string | null;
  similarity: number;
}
```

Add to `IItemsRepository`:

```ts
  findNearestConfirmedMatch(
    businessId: string,
    excludeItemId: string,
    queryVector: number[],
    limit: number,
  ): Promise<NearestConfirmedMatch[]>;
```

Add the implementation:

```ts
  findNearestConfirmedMatch(
    businessId: string,
    excludeItemId: string,
    queryVector: number[],
    limit: number,
  ): Promise<NearestConfirmedMatch[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT id, "categoryId", "canonicalName", unit,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM items
      WHERE "businessId" = ${businessId} AND "categoryConfirmed" = true AND "categoryId" IS NOT NULL
        AND id != ${excludeItemId} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }
```

- [ ] **Step 2: Simplify `pickConfirmedMatch` in `items.helpers.ts`**

Replace:

```ts
export interface MatchCandidate {
  categoryId: string;
  canonicalName: string;
  unit: string | null;
  embedding: number[];
}

/**
 * Rung-1 human-feedback reuse: find a human-confirmed item to copy the category from, so a
 * confirmation on one size of a product propagates to its siblings instead of the LLM
 * re-guessing (inconsistently) each time. Requires ALL THREE of the repo's proven signals —
 * cosine >= threshold, identical numeric specs, matching unit — the same bar boq-enrichment
 * uses before trusting a historical rate. Deterministic once embeddings exist; no LLM.
 */
export function pickConfirmedMatch(
  target: { canonicalName: string; unit: string | null; embedding: number[] },
  candidates: MatchCandidate[],
  threshold: number,
): { categoryId: string; confidence: number } | null {
  if (target.embedding.length === 0) return null;

  let best: { candidate: MatchCandidate; similarity: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.embedding.length === 0) continue;
    const similarity = cosineSimilarity(target.embedding, candidate.embedding);
    if (!best || similarity > best.similarity) best = { candidate, similarity };
  }
  if (!best) return null;

  const unitOk = target.unit === null || best.candidate.unit === target.unit;
  if (best.similarity >= threshold && unitOk && sameSpec(target.canonicalName, best.candidate.canonicalName)) {
    return { categoryId: best.candidate.categoryId, confidence: best.similarity };
  }
  return null;
}
```

with:

```ts
/**
 * Rung-1 human-feedback reuse: reuse a human-confirmed item's category if it's provably the SAME
 * item as `target` — cosine already found `best` as the nearest confirmed candidate (via ANN);
 * this only checks the two signals cosine similarity alone can't guarantee: identical numeric
 * specs and matching unit. The same bar boq-enrichment uses before trusting a historical rate.
 */
export function pickConfirmedMatch(
  target: { canonicalName: string; unit: string | null },
  best: Pick<NearestConfirmedMatch, "categoryId" | "canonicalName" | "unit" | "similarity"> | null,
  threshold: number,
): { categoryId: string; confidence: number } | null {
  if (!best) return null;

  const unitOk = target.unit === null || best.unit === target.unit;
  if (best.similarity >= threshold && unitOk && sameSpec(target.canonicalName, best.canonicalName)) {
    return { categoryId: best.categoryId, confidence: best.similarity };
  }
  return null;
}
```

Update the top of `items.helpers.ts`. Replace:

```ts
import type { CategoryLeafDto } from "@bmp/types";

import { cosineSimilarity } from "../../shared/utils/math.js";
import { sameSpec } from "../../shared/utils/spec-match.js";
```

with:

```ts
import type { CategoryLeafDto } from "@bmp/types";

import { sameSpec } from "../../shared/utils/spec-match.js";
import type { NearestConfirmedMatch } from "./items.repository.js";
```

(`cosineSimilarity` is no longer used in this file — the ranking it did moved into SQL.)

- [ ] **Step 3: Restructure `items.service.ts`**

Replace `loadClassifyContext`:

```ts
  private async loadClassifyContext(businessId: string): Promise<{
    leaves: CategoryLeafDto[];
    pathMap: Map<string, string>;
    confirmed: ConfirmedMatchRow[];
  }> {
    const [leaves, pathMap, confirmed] = await Promise.all([
      this.requireLeaves(),
      this.categoriesService.getPathMap(),
      this.itemsRepository.findConfirmedForMatch(businessId),
    ]);

    // Converge-on-use: embed any confirmed candidate that isn't embedded yet, so the pool of
    // reusable human decisions grows without a separate backfill (mirrors embedPendingRates).
    const pending = confirmed.filter((c) => !c.embeddedAt || c.embedding.length === 0);
    if (pending.length > 0) {
      const vectors = await this.safeEmbed(pending.map((c) => c.canonicalName));
      for (const [index, candidate] of pending.entries()) {
        const vector = vectors[index];
        if (vector) {
          candidate.embedding = vector;
          candidate.embeddedAt = new Date();
          await this.itemsRepository.setEmbedding(candidate.id, vector);
        }
      }
    }

    return { leaves, pathMap, confirmed };
  }
```

with:

```ts
  private async loadClassifyContext(businessId: string): Promise<{
    leaves: CategoryLeafDto[];
    pathMap: Map<string, string>;
  }> {
    const [leaves, pathMap, confirmed] = await Promise.all([
      this.requireLeaves(),
      this.categoriesService.getPathMap(),
      this.itemsRepository.findConfirmedForMatch(businessId),
    ]);

    // Converge-on-use: embed any confirmed candidate that isn't embedded yet, so the pool of
    // reusable human decisions grows without a separate backfill (mirrors embedPendingRates).
    // This fetch is unrelated to matching (that's ANN, per-item, in suggestForItem below) — it
    // exists purely to find rows that still need an embedding at all.
    const pending = confirmed.filter((c) => !c.embeddedAt || c.embedding.length === 0);
    if (pending.length > 0) {
      const vectors = await this.safeEmbed(pending.map((c) => c.canonicalName));
      for (const [index, candidate] of pending.entries()) {
        const vector = vectors[index];
        if (vector) await this.itemsRepository.setEmbedding(candidate.id, vector);
      }
    }

    return { leaves, pathMap };
  }
```

Replace `suggestForItem`:

```ts
  private async suggestForItem(
    item: ItemForClassify,
    context: {
      leaves: CategoryLeafDto[];
      pathMap: Map<string, string>;
      confirmed: ConfirmedMatchRow[];
    },
  ): Promise<ClassificationResult> {
    let embedding = item.embedding;
    if (!item.embeddedAt || embedding.length === 0) {
      embedding = (await this.safeEmbed([item.canonicalName]))[0] ?? [];
      if (embedding.length > 0) await this.itemsRepository.setEmbedding(item.id, embedding);
    }

    const others = context.confirmed.filter((c) => c.id !== item.id && c.embedding.length > 0);

    const candidates: MatchCandidate[] = others.map((c) => ({
      categoryId: c.categoryId,
      canonicalName: c.canonicalName,
      unit: c.unit,
      embedding: c.embedding,
    }));
    const sibling = pickConfirmedMatch(
      { canonicalName: item.canonicalName, unit: item.unit, embedding },
      candidates,
      env.AI_MATCH_THRESHOLD,
    );
    if (sibling) return sibling;

    // Nearest confirmed examples ground the LLM — the practical "learn from feedback" lever.
    const examples =
      embedding.length > 0
        ? others
            .map((c) => ({ row: c, sim: cosineSimilarity(embedding, c.embedding) }))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, CLASSIFY_EXAMPLE_LIMIT)
            .map((x) => ({ name: x.row.canonicalName, path: context.pathMap.get(x.row.categoryId) ?? "" }))
            .filter((e) => e.path)
        : [];

    const prompt = buildClassifyPrompt(item.canonicalName, item.unit, context.leaves, examples);
    const raw = await generateJson(prompt, env.OLLAMA_ENRICHMENT_MODEL);
    return parseClassification(raw, new Set(context.leaves.map((l) => l.id)));
  }
```

with:

```ts
  private async suggestForItem(
    item: ItemForClassify,
    context: { leaves: CategoryLeafDto[]; pathMap: Map<string, string> },
    businessId: string,
  ): Promise<ClassificationResult> {
    let embedding = item.embedding;
    if (!item.embeddedAt || embedding.length === 0) {
      embedding = (await this.safeEmbed([item.canonicalName]))[0] ?? [];
      if (embedding.length > 0) await this.itemsRepository.setEmbedding(item.id, embedding);
    }

    // One ANN query serves both downstream consumers: the sibling-reuse check (needs only the
    // nearest candidate) and the LLM's few-shot examples (needs up to CLASSIFY_EXAMPLE_LIMIT).
    const nearest =
      embedding.length > 0
        ? await this.itemsRepository.findNearestConfirmedMatch(businessId, item.id, embedding, CLASSIFY_EXAMPLE_LIMIT)
        : [];

    const sibling = pickConfirmedMatch(
      { canonicalName: item.canonicalName, unit: item.unit },
      nearest[0] ?? null,
      env.AI_MATCH_THRESHOLD,
    );
    if (sibling) return sibling;

    // Nearest confirmed examples ground the LLM — the practical "learn from feedback" lever.
    const examples = nearest
      .map((row) => ({ name: row.canonicalName, path: context.pathMap.get(row.categoryId) ?? "" }))
      .filter((e) => e.path);

    const prompt = buildClassifyPrompt(item.canonicalName, item.unit, context.leaves, examples);
    const raw = await generateJson(prompt, env.OLLAMA_ENRICHMENT_MODEL);
    return parseClassification(raw, new Set(context.leaves.map((l) => l.id)));
  }
```

Update both call sites to pass `businessId` (both already have it in scope):

```ts
    const result = await this.suggestForItem(item, context);
```

(inside `classifyItem`) becomes:

```ts
    const result = await this.suggestForItem(item, context, businessId);
```

```ts
        const result = await this.suggestForItem(item, context);
```

(inside `classifyUnclassified`'s loop) becomes:

```ts
        const result = await this.suggestForItem(item, context, businessId);
```

Update the top-of-file import block. Replace:

```ts
import { cosineSimilarity } from "../../shared/utils/math.js";
import type { CategoriesService } from "../categories/categories.service.js";
import type { RfqService } from "../rfq/rfq.service.js";

import {
  buildClassifyPrompt,
  type ClassificationResult,
  deriveCanonicalName,
  type MatchCandidate,
  parseClassification,
  pickConfirmedMatch,
} from "./items.helpers.js";
import { aggregateQuotes, sortItemEntries, toItemDetailDto, toItemListEntryDto } from "./items.mapper.js";
import type {
  ConfirmedMatchRow,
  IItemsRepository,
  ItemForClassify,
  ItemRow,
} from "./items.repository.js";
```

with:

```ts
import type { CategoriesService } from "../categories/categories.service.js";
import type { RfqService } from "../rfq/rfq.service.js";

import {
  buildClassifyPrompt,
  type ClassificationResult,
  deriveCanonicalName,
  parseClassification,
  pickConfirmedMatch,
} from "./items.helpers.js";
import { aggregateQuotes, sortItemEntries, toItemDetailDto, toItemListEntryDto } from "./items.mapper.js";
import type {
  IItemsRepository,
  ItemForClassify,
  ItemRow,
} from "./items.repository.js";
```

(`cosineSimilarity`, `MatchCandidate`, and `ConfirmedMatchRow` are all now unused in this file —
`ConfirmedMatchRow` was only referenced as an explicit type annotation on `loadClassifyContext`'s
return type and `suggestForItem`'s `context` parameter, both removed above; the `confirmed` local
inside `loadClassifyContext` still gets its type inferred from
`this.itemsRepository.findConfirmedForMatch(businessId)`'s own return type without needing the
import here.)

- [ ] **Step 4: Write the integration test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ItemsRepository } from "../items.repository.js";

describe("findNearestConfirmedMatch (Item ANN, integration)", () => {
  const repository = new ItemsRepository(prisma);
  let businessId: string;
  let categoryId: string;
  const itemIds: string[] = [];

  async function insertConfirmedItem(canonicalName: string, vector: number[] | null): Promise<string> {
    const id = randomUUID();
    await prisma.item.create({
      data: {
        id,
        businessId,
        canonicalName,
        unit: "nos",
        categoryId,
        categoryConfirmed: true,
        embedding: vector ?? [],
        embeddedAt: vector ? new Date() : null,
      },
    });
    if (vector) {
      const vectorLiteral = `[${vector.join(",")}]`;
      await prisma.$executeRaw`UPDATE items SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
    }
    itemIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "ANN Item Test Business", code: `ANNI${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const category = await prisma.category.create({
      data: { id: randomUUID(), name: "ANN Test Category" },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("excludes the target item itself even at identical similarity", async () => {
    const dims = 1024;
    const vector = new Array(dims).fill(0);
    vector[0] = 1;

    const selfId = await insertConfirmedItem("Self Item", vector);
    await insertConfirmedItem("Sibling Item", vector);

    const results = await repository.findNearestConfirmedMatch(businessId, selfId, vector, 20);

    expect(results.some((r) => r.id === selfId)).toBe(false);
    expect(results.some((r) => r.canonicalName === "Sibling Item")).toBe(true);
  });

  it("excludes items with no embeddingVector and respects the limit", async () => {
    const dims = 1024;
    const vector = new Array(dims).fill(0);
    vector[0] = 1;

    await insertConfirmedItem("Unembedded Item", null);
    const excludeId = randomUUID();

    const results = await repository.findNearestConfirmedMatch(businessId, excludeId, vector, 1);

    expect(results.every((r) => r.canonicalName !== "Unembedded Item")).toBe(true);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 5: Update `items.helpers.spec.ts`'s `pickConfirmedMatch` tests**

There is no `items.service.spec.ts` in this codebase (confirmed) — `suggestForItem`/
`loadClassifyContext` have no dedicated unit test today, so this task's only existing-test
casualty is `items.helpers.spec.ts`'s `describe("pickConfirmedMatch", ...)` block, which calls it
with the old `(target-with-embedding, candidates-array, threshold)` signature. Replace that whole
block:

```ts
describe("pickConfirmedMatch", () => {
  const candidate = (categoryId: string, canonicalName: string, unit: string | null, embedding: number[]) => ({
    categoryId,
    canonicalName,
    unit,
    embedding,
  });

  it("reuses a confirmed sibling when cosine, specs and unit all agree", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M", embedding: [1, 0] },
      [candidate("c1", "PU Tube ID 4 OD 6", "M", [1, 0])],
      0.98,
    );
    expect(match).toEqual({ categoryId: "c1", confidence: 1 });
  });

  it("refuses a spec mismatch even at cosine 1 (different size is a different item)", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M", embedding: [1, 0] },
      [candidate("c1", "PU Tube ID 7 OD 10", "M", [1, 0])],
      0.98,
    );
    expect(match).toBeNull();
  });

  it("refuses when cosine is below threshold", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M", embedding: [1, 0] },
      [candidate("c1", "PU Tube ID 4 OD 6", "M", [0, 1])],
      0.98,
    );
    expect(match).toBeNull();
  });

  it("refuses on a unit mismatch", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M", embedding: [1, 0] },
      [candidate("c1", "PU Tube ID 4 OD 6", "NOS", [1, 0])],
      0.98,
    );
    expect(match).toBeNull();
  });
});
```

with:

```ts
describe("pickConfirmedMatch", () => {
  const candidate = (categoryId: string, canonicalName: string, unit: string | null, similarity: number) => ({
    categoryId,
    canonicalName,
    unit,
    similarity,
  });

  it("reuses a confirmed sibling when cosine, specs and unit all agree", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M" },
      candidate("c1", "PU Tube ID 4 OD 6", "M", 1),
      0.98,
    );
    expect(match).toEqual({ categoryId: "c1", confidence: 1 });
  });

  it("refuses a spec mismatch even at cosine 1 (different size is a different item)", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M" },
      candidate("c1", "PU Tube ID 7 OD 10", "M", 1),
      0.98,
    );
    expect(match).toBeNull();
  });

  it("refuses when cosine is below threshold", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M" },
      candidate("c1", "PU Tube ID 4 OD 6", "M", 0),
      0.98,
    );
    expect(match).toBeNull();
  });

  it("refuses on a unit mismatch", () => {
    const match = pickConfirmedMatch(
      { canonicalName: "PU Tube ID 4 OD 6", unit: "M" },
      candidate("c1", "PU Tube ID 4 OD 6", "NOS", 1),
      0.98,
    );
    expect(match).toBeNull();
  });

  it("returns null when there is no candidate", () => {
    expect(pickConfirmedMatch({ canonicalName: "PU Tube ID 4 OD 6", unit: "M" }, null, 0.98)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the new test and the existing items test suite**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/items`
Expected: PASS, including the two new ANN integration tests and the updated
`items.helpers.spec.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/items
git commit -m "feat(items): replace brute-force sibling/example matching with pgvector ANN"
```

---

### Task 11: Final cleanup and full regression pass

**Files:**
- Modify: `apps/server/src/shared/utils/math.ts` (only if `cosineSimilarity` is confirmed dead)
- No other planned file changes — this task verifies and tidies, it does not add features.

**Interfaces:** None new. This task's job is to confirm nothing from Tasks 1–10 left dead code or
a broken reference, and that the whole server test suite is green together (not just per-module).

- [ ] **Step 1: Check whether `cosineSimilarity` has any remaining caller**

Run: `grep -rl "cosineSimilarity" apps/server/src`

If the only remaining matches are inside `apps/server/src/shared/utils/math.ts` itself (its
definition) and/or test files that test `math.ts` directly, it's dead in production code — remove
the `cosineSimilarity` export from `math.ts` and its dedicated test cases (if any) in
`apps/server/src/shared/utils/__tests__/math.spec.ts` (leave any other exports from that file, e.g.
`round2`, untouched). If anything else still calls it, leave it in place and note the caller in the
implementer's report — do not force removal.

- [ ] **Step 2: Confirm `pdf-parse` is fully gone**

Run: `grep -rl "pdf-parse" apps/server` (no `/src` restriction this time — also checks
`package.json`, lockfile references, etc.)
Expected: no output.

- [ ] **Step 3: Full server test suite**

Run: `pnpm --filter @bmp/server exec vitest run`
Expected: PASS, 0 failures — this is the first run exercising every module together after 10 tasks
of changes across `attachments`, `boq`, `reports`, `rates`, `items`.

- [ ] **Step 4: Full typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no errors. (Per CLAUDE.md's gotcha, ensure the `web` dev server isn't running
concurrently if this is run alongside any `@bmp/web` command — not applicable here since this
plan touches no web code, but stated for the record.)

- [ ] **Step 5: Manual smoke test of all three PDF call sites and one ANN path**

Not automated — run once, report results:
1. Upload a real PDF as a tender document; confirm `document-indexing.service`'s job (check
   worker logs) extracts non-empty text and the attachment's `extractedText`/`embeddingVector`
   columns populate.
2. Use `/search` (or the reports search endpoint) with a query matching that PDF's content;
   confirm it now surfaces via content match, not just filename.
3. Upload a PDF as a BOQ; confirm `parseBoqFile`'s PDF branch returns non-empty lines instead of
   erroring.

- [ ] **Step 6: Commit (if Step 1 removed anything)**

```bash
git add apps/server/src/shared/utils/math.ts apps/server/src/shared/utils/__tests__/math.spec.ts
git commit -m "chore(server): remove dead cosineSimilarity helper after ANN migration"
```

If Step 1 found a remaining caller and nothing was removed, skip this commit — there's nothing to
commit for this task.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (PDF) — Tasks 1–4 cover the utility, all three call sites, dependency
  removal, and Dockerfile/docs. Part 2 (ANN) — Task 5 (infra image), Task 6 (schema/migration),
  Task 7 (write sync), Tasks 8–10 (the three read paths, including the corrected unified Item
  design), Task 11 (cleanup + regression). Every numbered item in the spec's "Design" section maps
  to a task above.
- **Type consistency:** each of the three ANN read methods returns its own dedicated flat type
  sized to exactly what its SQL selects and what its downstream consumer needs — `(
  AttachmentMetadataRow & { similarity })` for attachments (its consumer needs only `id`/
  `originalName`/`entityId`, already the existing DTO row shape), `HistoricalRateMatch` for rates
  (flat, replacing the old nested `Match.rate.x` shape — `classify()`/`buildPrompt()` in
  `boq-enrichment.service.ts` were rewritten to match, not just their caller), and
  `NearestConfirmedMatch` for items (deliberately *not* `ConfirmedMatchRow & { similarity }`, since
  that would falsely claim an `embedding`/`embeddedAt` the ANN row never carries).
  `pickConfirmedMatch`'s new signature (Task 10, Step 2) matches exactly what `suggestForItem`
  (Task 10, Step 3) passes it. Every field name in every raw SQL `SELECT` list was checked against
  the actual interface definitions and actual Prisma schema field names (no `@map` renames on any
  of the three models — column names equal Prisma field names verbatim) before being written into
  this plan. Existing tests whose fakes/fixtures reference the types being removed
  (`boq-enrichment.service.spec.ts`'s `FakeRatesRepository`, `items.helpers.spec.ts`'s
  `pickConfirmedMatch` tests) were read in full and their exact replacements written into Tasks 9
  and 10 — not left as a vague "update the tests" instruction.
- **Placeholder scan:** no "TBD"/"similar to Task N" — every step above has complete code or an
  exact command.
