# PDF Extraction Fix + ANN Vector Search — Design

**Date:** 2026-08-28
**Status:** Draft

## Context

Two follow-ups from the document-search-assistant work (`2026-08-27-document-search-assistant-design.md`):

1. **PDF content-indexing is confirmed non-functional in production.** A post-merge manual smoke
   test (real server via `tsx`, real Postgres/Redis/MinIO/Ollama, no mocks) uploaded a real PDF and
   found the indexing job completed with zero errors but extracted nothing. Root-caused directly:
   `pdf-parse@1.1.4`'s bundled pdf.js (a 2017-era webpack build) throws when loaded through this
   app's actual module loaders — three different real/synthetic PDFs, three different internal
   pdf.js errors (`bad XRef entry`, `Illegal character: 41`, `Invalid number: g`), none of them
   content-related (the PDFs all have genuine embedded text). All three fail under `tsx` (real
   production runtime) exactly as they failed under vitest. Confirmed via plain `node -e
   require("pdf-parse")` on the identical bytes: works every time. This is a loader/bundling
   incompatibility, not a text-extraction or content problem — DOCX extraction (`docxtemplater`)
   is unaffected.

   Checking every consumer of `pdf-parse` in this codebase (not just the document-search feature)
   found two more: `boq.parser.ts` (BOQ PDF upload) and `tender-extraction.parser.ts` (the "extract
   tender from document" upload feature). Both call `pdfParse(buffer)` and use only `.text` from
   the result — same defect, same blast radius, silently broken in production the same way. Fixing
   all three in one pass, not just the search feature, since it's the identical bug with the
   identical fix.

2. **ANN (approximate nearest neighbor) search, requested explicitly**, to replace the brute-force
   cosine-similarity scan currently used for embeddings. Three places in this codebase already do
   the identical thing — plain `Float[]` column + `cosineSimilarity()` in application code,
   scanning every embedded row for a business on every query: `Attachment` (document content
   search, just shipped), `HistoricalRate` (BOQ rate-matching), and `Item` (canonical item
   classification matching). `HistoricalRate.embedding`'s own schema comment already named the
   upgrade path: *"Swap to pgvector (`Unsupported("vector(N)")` + `$queryRaw` + HNSW) if a cosine
   sweep ever shows up in the job's timing logs."* Doing all three together rather than leaving one
   of three identical call sites on the old pattern.

## Goals

**PDF extraction:**
- A new shared utility, `extractPdfText(buffer): Promise<string>`, backed by poppler's `pdftotext`
  CLI (spawned as a subprocess — no Node module loading involved, sidesteps the pdf.js
  incompatibility entirely) instead of the `pdf-parse` npm package.
- All three current `pdf-parse` call sites (`document-indexing.service.ts`,
  `boq.parser.ts`, `tender-extraction.parser.ts`) switch to it. `pdf-parse` removed from
  `apps/server/package.json` entirely — nothing left using it.
- `poppler-utils` added wherever the server actually runs: `apps/server/Dockerfile`'s runner
  stage (Alpine → `apk add poppler-utils`), and documented as a local-dev prerequisite.

**ANN search:**
- `pgvector` extension enabled on Postgres (image swap: `postgres:16-alpine` →
  `pgvector/pgvector:pg16` — same Postgres core/data format, existing `pgdata` volume mounts
  unchanged).
- `Attachment`, `HistoricalRate`, and `Item` each get a new `Unsupported("vector(1024)")` column
  (1024 = bge-m3's real embedding dimension, verified live against the running Ollama instance,
  not assumed) alongside their existing `Float[]` column, plus an HNSW index
  (`vector_cosine_ops`, matching the cosine semantics every existing threshold already assumes).
- Every write to the existing `Float[]` embedding column also writes the new vector column (one
  extra `$executeRaw` per write site — three total: `document-indexing.service.ts`,
  `rates.repository.ts#setEmbedding`, `items.repository.ts#setEmbedding`).
- Every brute-force "fetch every embedded row, rank in JS" read path is replaced by one indexed
  `$queryRaw` per module, returning only the top-K candidates with their similarity already
  computed — the surrounding business logic (threshold checks, `sameSpec()`, dedup, DTO mapping)
  is untouched; only *how the ranked candidates arrive* changes. This also incidentally fixes an
  unbounded-per-request-work concern flagged in the prior spec's final review (`/search` no longer
  pulls every embedded attachment's full vector into application memory on every keystroke).
- A one-time backfill (in the same migration) populates the new vector column from any existing
  `Float[]` data, so already-embedded rows aren't silently dropped from search after the cutover.

## Non-goals

- **Changing `OLLAMA_EMBED_MODEL` to a different-dimension model.** `vector(1024)` is fixed at
  migration time; switching to a model with a different output dimension needs a new migration.
  Not addressed here — this locks in bge-m3's current dimension, matching what's already deployed.
- **OCR for scanned/image-only PDFs.** `pdftotext` (like `pdf-parse` before it) only reads a PDF's
  existing text layer — a scanned document with no embedded text still yields nothing. Real,
  separate feature (rasterize + a vision-capable local Ollama model), not part of this fix.
- **Removing `Float[]` columns.** Kept alongside the new vector columns per explicit decision —
  smaller diff, no changes needed anywhere that currently reads embeddings as a plain JS array
  outside the three read paths being replaced. Revisit if the duplicate storage (~8KB/row extra
  per embedded row) ever actually matters at this data scale.
- **CI/test-infra changes for `pdftotext`.** No existing test in this codebase feeds a real PDF
  buffer through `pdf-parse` today (confirmed: neither `boq.parser.ts` nor
  `tender-extraction.parser.ts` has a dedicated test exercising the PDF branch at all;
  `document-indexing.service.spec.ts`'s PDF cases already mock at the module level). The one new
  test this design adds for `extractPdfText` itself requires `poppler-utils` installed wherever
  tests run — documented as a prerequisite, same class of requirement as the existing MinIO test
  bucket.

## Design

### Part 1 — PDF extraction

**New file** `apps/server/src/shared/utils/pdf-text.ts`:

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

**Call site 1** — `apps/server/src/modules/attachments/document-indexing.service.ts`: replace
`import pdfParse from "pdf-parse";` with `import { extractPdfText } from
"../../shared/utils/pdf-text.js";`; the PDF branch becomes:

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

(Unchanged behavior/contract: still returns `null` on any failure, never throws — this call site's
try/catch already matches `extractPdfText`'s throw-on-failure design.)

**Call site 2** — `apps/server/src/modules/boq/boq.parser.ts`: replace the `pdf-parse` import with
the shared one; `const data = await pdfParse(buffer); const lines = data.text...` becomes `const
text = await extractPdfText(buffer); const lines = text...`. No try/catch here today (the function
already propagates extraction failure to its caller) — unchanged.

**Call site 3** — `apps/server/src/modules/tenders/tender-extraction.parser.ts`: this file already
has a **private** function named `extractPdfText` that wraps `pdfParse` — delete that local
function entirely and import the shared one of the same name instead:

```ts
import { extractPdfText } from "../../shared/utils/pdf-text.js";
```

The one call site (`text = await extractPdfText(buffer);`) needs no change — same name, same
signature, now backed by `pdftotext` instead of `pdf-parse`.

**Dependency removal** — remove `pdf-parse` (and its `@types/pdf-parse` if present) from
`apps/server/package.json`; confirm no other file imports it (`grep -rl "pdf-parse" apps/server/src`
should return nothing once the three call sites above are updated).

**Dockerfile** — `apps/server/Dockerfile`'s `runner` stage (Alpine base) needs, before `USER bmp`:

```dockerfile
RUN apk add --no-cache poppler-utils
```

**Local dev prerequisite** — document in `CLAUDE.md`'s gotchas: `pdftotext` (from poppler-utils)
must be installed on any machine running `pnpm dev`'s server/worker for real PDF extraction to
work (`brew install poppler` on macOS). Replace the existing "`pdf-parse` v2 is a heavy rewrite...
don't helpfully upgrade it" gotcha entry entirely — it's now obsolete (the package is gone) and
was itself the seed of this whole investigation.

**New test** `apps/server/src/shared/utils/__tests__/pdf-text.spec.ts` — a real (non-mocked) test,
since spawning a subprocess isn't subject to the module-loader incompatibility that made mocking
necessary for `pdf-parse`:

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

(This exact hand-rolled PDF builder is verified working — it's the same fixture proven during the
prior spec's `pdf-parse`-under-vitest investigation, confirmed readable by `node -e require`,
Ghostscript-equivalent tooling, and now needs confirming against `pdftotext` specifically as part
of implementing this test.)

**`document-indexing.service.spec.ts` update** — its existing PDF test cases mock `pdf-parse`
(`vi.mock("pdf-parse", ...)`); since that package is being removed, switch the mock target to the
new shared module instead: `vi.mock("../../../shared/utils/pdf-text.js", () => ({ extractPdfText:
extractPdfTextMock }))`. The three existing PDF test cases (success, empty-text, throws) keep their
exact assertions — only the mock's target module changes.

### Part 2 — ANN vector search

**Infra** — `docker-compose.yml`: change `image: postgres:16-alpine` to `image:
pgvector/pgvector:pg16` on the `postgres` service. Same Postgres 16 core, same data directory
format — the existing `pgdata` volume mounts without a dump/restore, `CREATE EXTENSION vector`
alone activates the capability.

**Schema** — add to `Attachment`, `HistoricalRate`, and `Item` (each already has `embedding
Float[]` / `embeddedAt DateTime?`):

```prisma
embeddingVector Unsupported("vector(1024)")?
```

**Migration** (hand-written SQL — Prisma can't generate `vector`-type DDL on its own; use `prisma
migrate dev --create-only` then edit the generated file):

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

This needs applying to **both** `bmp` and `bmp_test` databases (the extension and columns are
per-database) — the test database picks it up the same way it already picks up every other
migration, via whatever this project's existing `migrate:deploy`-against-`.env.test` step is.

**Write side** — each of the three `setEmbedding`-equivalent methods gets one extra raw statement
after the existing Prisma write. Shared shape:

```ts
const vectorLiteral = `[${embedding.join(",")}]`;
await this.prisma.$executeRaw`UPDATE attachments SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
```

(table name swapped per repository: `attachments`, `historical_rates`, `items`). Applied in:
- `document-indexing.service.ts#indexAttachment` (both the "embed succeeded" and none — no vector
  write needed on the Ollama-down degraded path, since there's no vector to write yet).
- `rates.repository.ts#setEmbedding`.
- `items.repository.ts#setEmbedding`.

**Read side** — one new repository method per module, replacing the "fetch every embedded row"
method at its call site (the old method can stay if anything else still uses it, otherwise remove
it):

```ts
// reports.repository.ts — replaces findEmbeddedAttachments's role in reports.service.ts
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

(`variant = 'ORIGINAL'` matches the exact filter `findEmbeddedAttachments`/`searchAttachmentsByMetadata` already apply today — without it, thumbnail variant rows would compete in the ranking alongside their originals.)

`reports.service.ts#searchAttachments` calls this directly with `env.DOCUMENT_MATCH_THRESHOLD` and
the existing cap (5), instead of fetching every embedded row and cosine-ranking in JS. The
`ServiceUnavailableError`-catch-and-degrade-to-metadata-only behavior around the `embed(query)`
call is unchanged — it still needs to embed the query text via Ollama before it has a vector to
query with; only what happens *after* getting that vector changes.

**`HistoricalRate`**: `rates.repository.ts` gets a new `findNearest(businessId, queryVector,
limit): Promise<(HistoricalRateVector & { similarity: number })[]>`, scoped by `businessId`
directly (no two-step resolution needed, unlike `Attachment`). `boq-enrichment.service.ts` calls it
instead of `findEmbedded(businessId)` + its own private `rank()` method — `rank()` is deleted
entirely (its whole job, "map every candidate to a similarity and sort," now happens in the SQL
query). The surrounding logic downstream of the ranked list — `AI_MATCH_THRESHOLD` comparison,
`sameSpec()` check, `LLM_CONTEXT_CANDIDATES` slicing for the LLM prompt — is unchanged; it already
just consumes an array of `{ rate, similarity }` in descending-similarity order, which the SQL
query now produces directly.

**`Item`**: `items.service.ts#suggestForItem` actually has *two* separate brute-force cosine
consumers of the same "confirmed items" pool, not one — a fact the earlier draft of this section
missed:

1. `pickConfirmedMatch()` — the deterministic sibling-reuse check, needs only the single nearest
   candidate.
2. A second, separate scan building the LLM's few-shot grounding examples (`CLASSIFY_EXAMPLE_LIMIT
   = 20`): rank every confirmed candidate by cosine, take the top 20, map to `{name, path}`.

Both draw from the identical candidate pool and the identical query vector (the item being
classified) — they differ only in how many of the ranked results each one uses. One ANN query
serves both: `items.repository.ts` gets a new `findNearestConfirmedMatch(businessId, excludeItemId,
queryVector, limit): Promise<(ConfirmedMatchRow & { similarity: number })[]>`, same `WHERE
businessId = ... AND "categoryConfirmed" = true AND "categoryId" IS NOT NULL` filter
`findConfirmedForMatch` already uses, **plus `AND id != excludeItemId`**, ordered nearest-first,
**unfiltered by threshold** (unlike the `Attachment` read path — the examples consumer wants the
top 20 regardless of similarity, and the sibling check applies its own threshold downstream to just
the first row), `LIMIT` = `CLASSIFY_EXAMPLE_LIMIT` (20, comfortably covering both consumers in one
round trip).

The exclusion (`AND id != excludeItemId`) matters: today it happens in `items.service.ts`'s
classify path (`context.confirmed.filter((c) => c.id !== item.id && ...)`, *before* the filtered
rows are ever shaped into the `MatchCandidate[]` that `items.helpers.ts#pickConfirmedMatch`
receives — `MatchCandidate` itself carries no `id` field, so there's nowhere downstream of that
filter to re-derive it). Missing it in the new method would let an item's own embedding "match"
itself at similarity 1.0 every time, silently breaking the whole feature.

`items.helpers.ts#pickConfirmedMatch(target, candidates, threshold)` today does two jobs in one
loop: find the highest-cosine candidate, *then* check it clears `threshold` AND has a matching
`unit` AND passes `sameSpec()`. Only the first job (the scan-and-rank) moves into SQL. Simplify
`pickConfirmedMatch` to take the single best candidate SQL already found (or `null`, if the result
list was empty) instead of a candidate array — it keeps the `unit`/`sameSpec()` checks exactly as
they are today (those aren't cosine-based and have no SQL equivalent), just applied to one
pre-selected candidate instead of found via its own loop.

`items.service.ts#suggestForItem` calls `findNearestConfirmedMatch` once per item, feeds its first
result into the simplified `pickConfirmedMatch` for the sibling check, and — only if that returns
null — maps the same result array (up to 20 rows) into the LLM's `examples` list. This also lets
`loadClassifyContext` drop `confirmed: ConfirmedMatchRow[]` from what it hands to `suggestForItem`
for matching purposes; it still bulk-fetches confirmed items via `findConfirmedForMatch`, but only
to drive its unrelated "embed any confirmed item that isn't embedded yet" convergence step, not for
ranking.

`cosineSimilarity()` in `shared/utils/math.ts` has no remaining callers once all three read paths
are migrated — confirmed via `grep -rl cosineSimilarity apps/server/src` before removing it; delete
if genuinely dead, leave a note if anything still calls it.

### Testing

- **`extractPdfText`**: one real (non-mocked) unit test, per Part 1 above.
- **`document-indexing.service.spec.ts`**: mock target swapped from `pdf-parse` to the shared
  `pdf-text.js` module; assertions unchanged.
- **ANN read paths**: one integration test per module (`Attachment`, `HistoricalRate`, `Item`),
  each inserting a few real rows with distinct embeddings via `$executeRaw` (or through the real
  `setEmbedding` write path, proving the write side too) directly against the pgvector-enabled test
  database, then calling the new repository method and asserting the expected ranking/threshold
  behavior — this is the first time any of these three ranking paths gets a real-database proof
  rather than a fake-repository unit test with hand-picked `[1,0]`/`[0,1]` vectors (those unit tests
  stay too, unchanged, since they test the *service* layer's threshold/dedup logic against a faked
  repository return value, independent of how the repository gets that value).
- **Docker/migration**: no automated test for the image swap itself — verified manually (start
  the stack on the new image against the existing dev volume, confirm Postgres comes up clean,
  confirm `CREATE EXTENSION vector` succeeds, confirm the backfill UPDATE affects the expected row
  count).

## Scope boundaries

**In:** `extractPdfText` shared utility + all three call-site migrations + `pdf-parse` removal +
Dockerfile/CLAUDE.md updates; `pgvector` extension + vector columns + HNSW indexes on
`Attachment`/`HistoricalRate`/`Item` + backfill; raw-SQL write-side sync at all three
`setEmbedding` sites; raw-SQL ANN read methods replacing all three brute-force-fetch-and-rank call
sites; one new real unit test for `extractPdfText`; one new integration test per ANN-migrated
module.

**Out, by decision:**

| Deferred | Why |
|---|---|
| OCR for scanned PDFs | Separate feature — `pdftotext` still can't read a page with no text layer, same as `pdf-parse` before it |
| Removing `Float[]` columns | Explicit choice — smaller diff, no changes needed elsewhere; revisit if duplicate storage ever matters |
| Making `vector(N)`'s dimension dynamic | Not expressible with a static Prisma schema; a model-dimension change needs its own migration whenever it happens |
| CI system-dependency automation for `poppler-utils`/pgvector | Documented as prerequisites, same class of ask as the existing MinIO test-bucket requirement |

## Related

- `2026-08-27-document-search-assistant-design.md` — the feature whose final-review manual smoke
  test surfaced the PDF defect this spec fixes, and whose `Attachment.embedding` design this
  extends to real ANN indexing.
- `packages/database/prisma/schema.prisma`'s `HistoricalRate.embedding` comment — the exact
  upgrade path this spec now executes.
- `apps/server/src/modules/boq/boq-enrichment.service.ts`, `apps/server/src/modules/items/
  items.helpers.ts` — the two additional brute-force-cosine call sites folded into this migration
  for consistency, beyond what was originally discussed.
