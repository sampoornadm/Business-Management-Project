# Document Search & Assistant (#2 Vector Search, #3 Chatbot) — Design

**Date:** 2026-08-27
**Status:** Draft

## Context

Phase 1 of this initiative (shipped) made generated documents (bills, undertakings) attach
themselves to their tender automatically — they show up in the Documents tab and on disk, same as
uploaded documents. That solved *storage*. It didn't solve *finding*: the existing global search
(`/search`, `topbar-search.tsx`) only covers Tenders/Organizations/Vendors/Projects — bills and
every other tender document are invisible to it (confirmed directly: searching a real bill number
returns nothing).

This spec covers the next two pieces from the original ask: making every tender document
searchable by content, not just by knowing which tender it belongs to (#2), and a conversational
front-end over that search (#3).

**Reuse, not a new subsystem.** Three things this codebase already has turned out to cover nearly
all of it:

- **Embeddings without a vector database.** `HistoricalRate` already does exactly this for BOQ
  rate-matching: a plain `Float[]` column + brute-force cosine similarity in
  `shared/utils/math.ts`, fed by the local Ollama `embed()` call. Its own schema comment says
  *"fine to ~100k rows per business, swap to pgvector if a cosine sweep ever shows up in timing
  logs."* A tender-document corpus is nowhere near that. No Pinecone/Qdrant/pgvector — one more
  `Float[]` column on `Attachment`, same pattern.
- **Text extraction.** `pdf-parse` (already used for BOQ/tender PDF parsing) and
  `docxtemplater`'s `.getFullText()` (already a dependency, used for undertaking generation) cover
  PDF and DOCX — the two formats nearly everything here is in. Zero new npm packages.
- **A search surface already exists.** `/search` and `topbar-search.tsx` both search via simple
  `contains` queries against `reports.repository.ts`, gated by `reports:read`. Adding
  `"Attachment"` as a new `SearchEntityType` is the natural extension, not a new page.

## Goals

- Every `Attachment` (tender documents: NIT/BOQ/Drawings/Corrigendum/General/Bills/Undertakings/
  etc.) gets its text extracted and embedded in the background, without slowing down upload or
  document generation.
- `/search` and `topbar-search.tsx` return matching attachments alongside tenders/orgs/vendors/
  projects — matched by filename/tender-number/document-type (`contains`) **or** by content
  similarity (cosine ranking against the embedded query) — deduped, capped, linking to the
  tender's Documents tab.
- A new `/assistant` chat page: type a natural-language request ("find the bill for
  TST-1783835577-Sam"), get a conversational reply plus the same result cards `/search` renders.
  Retrieval only — it hands back what search found, it does not answer questions about what's
  *inside* a document.

## Non-goals (deferred, tracked separately)

- **OCR / image content search.** Drawings and scanned images get no text extraction — filename/
  document-type search still covers them. Add if it turns out to matter.
- **Chunking / multi-part retrieval.** One embedding per document, from roughly the first ~8k
  extracted characters — `ponytail:` a deliberate ceiling (bge-m3's context window comfortably
  covers a typical tender document in one pass); add chunking only if a real document turns out
  too long for one embedding to represent well.
- **Conversational memory.** Every `/assistant` message is parsed and searched independently; a
  follow-up like "show me its undertaking too" won't resolve "its" from the prior turn. Deliberate
  cut to keep #3 "retrieval only" simple — add a thread/session concept later if wanted.
- **Content Q&A ("what's the total on BILL-XYZ").** Explicitly out of scope per the retrieval-only
  decision — would mean feeding document text to the LLM and trusting its answer, a different and
  larger commitment (accuracy risk, longer documents straining a small local model).
- **A distinct `assistant` RBAC permission.** Both `/search`'s extension and `/assistant` reuse the
  existing `reports:read` permission — it's the same underlying read capability with two
  front-ends, not a new one.

## Design

### Data model

```prisma
model Attachment {
  // ...existing fields unchanged...

  // Content search (#2/#3). Populated lazily by the document-indexing worker, same convention
  // as HistoricalRate.embedding: plain Float[] + brute-force cosine, not pgvector.
  extractedText String?
  embedding     Float[]
  embeddedAt    DateTime?
}
```

No migration risk beyond the usual `prisma migrate dev` — all three columns are nullable/empty-
default, backfilling nothing for existing rows (they get indexed the same lazy way `boq-
enrichment.service.ts` backfills `HistoricalRate` on first use — no separate backfill script).

### Indexing pipeline

New queue, mirroring `AI_ENRICHMENT_QUEUE_NAME`/`ai-enrichment.worker.ts` exactly:

```ts
// infra/queue/queues.ts
export interface DocumentIndexingJobPayload { attachmentId: string }
export const DOCUMENT_INDEXING_QUEUE_NAME = "document-indexing";
export const documentIndexingQueue = new Queue<DocumentIndexingJobPayload, void, "index-document">(...);
```

`document-indexing.worker.ts` (new): for the job's attachment, download the object from
`s3Service`, extract text by mime type (`application/pdf` → `pdf-parse`; the two Office
`wordprocessingml` mime types → `docxtemplater(...).getFullText()`; anything else → skip
extraction, leave `extractedText` null), truncate to ~8k chars, `embed([text])` via the existing
Ollama client, store `extractedText`/`embedding`/`embeddedAt`. Same `ServiceUnavailableError`
handling as `ai-enrichment.worker.ts`: if Ollama is down, log and complete the job rather than
retry-storming a service that isn't there — extraction (which doesn't need Ollama) still
succeeds and gets stored even when embedding doesn't.

**Enqueue point:** `attachmentsService.upload()` — the single choke point every attachment
creation path already routes through (direct uploads, the local-docs-sync watcher, and the
generated-document save helper from phase 1). One `documentIndexingQueue.add(...)` call there
covers all three without touching any of their call sites.

Gated behind a new flag `DOCUMENT_INDEXING_ENABLED` (default off), same opt-in convention as
`LOCAL_DOCS_SYNC_ENABLED`/`INCOMING_TENDERS_INGESTION_ENABLED`/`AI_ENRICHMENT_ENABLED` — a
deployment that hasn't turned this on doesn't silently start spending CPU/Ollama cycles on every
upload.

### Search integration (#2)

`packages/types/src/report.ts`: add `"Attachment"` to `SEARCH_ENTITY_TYPES`.

`reports.repository.ts`: new `searchAttachments(businessId, query)` —

```ts
async searchAttachments(businessId: string, query: string): Promise<AttachmentSearchRow[]> {
  // Attachment.entityType/entityId is an unenforced generic reference (no FK, same shape as
  // AuditLog) — there's no `tender` relation to traverse. Same two-step resolution
  // docs-watcher.service.ts already uses: business -> its tender ids -> attachments on those ids.
  const tenderIds = await this.prisma.tender.findMany({
    where: { businessId },
    select: { id: true },
  }).then((rows) => rows.map((r) => r.id));

  const [byMetadata, byContent] = await Promise.all([
    this.prisma.attachment.findMany({
      where: {
        entityType: "Tender",
        entityId: { in: tenderIds },
        OR: [
          { originalName: { contains: query, mode: "insensitive" } },
          { documentType: { contains: query, mode: "insensitive" } },
        ],
      },
      take: SEARCH_LIMIT,
    }),
    this.searchAttachmentsByContent(tenderIds, query), // embeds `query`, cosine-ranks embedded rows
  ]);
  return dedupeById([...byMetadata, ...byContent]).slice(0, SEARCH_LIMIT);
}
```

Content-ranking reuses `cosineSimilarity` against every embedded attachment on those tender ids —
same brute-force approach as BOQ matching, fine at this scale. It needs its **own** threshold
constant (e.g. `DOCUMENT_MATCH_THRESHOLD`), not a reuse of BOQ's `AI_MATCH_THRESHOLD=0.98` — that
number was empirically calibrated for short item-name strings (per its own comment in
`boq-enrichment.service.ts`) and has no reason to transfer to whole-document cosine scores, which
behave differently at this length. Measure against real indexed documents during implementation,
same as `AI_MATCH_THRESHOLD` itself was measured against bge-m3 rather than guessed.

`reports.service.ts#search`: add `this.reportsRepository.searchAttachments(businessId, trimmed)`
to the existing `Promise.all`, map to `{ type: "Attachment", id, title: originalName, subtitle:
tenderNumber + documentType, href: "/tenders/{tenderId}?tab=documents" }`.

That `?tab=documents` link only works if the tender page's `Tabs` actually reads it — checked, it
currently doesn't (`<Tabs defaultValue="overview">`, no query-param wiring). Small explicit
addition needed alongside this: make the tab controlled, initialized from
`useSearchParams().get("tab") ?? "overview"`. Without it, every search/assistant result for a
document would land the user on Overview and require a manual click to Documents — undermines the
whole point of a result link.

**Frontend:** `/search/page.tsx` and `topbar-search.tsx` each add an `Attachment` entry to their
`Record<SearchEntityType, Icon>` map (`FileText` or similar) — TypeScript's exhaustiveness check
on that `Record` forces both, so neither can be missed.

### Chatbot (#3)

New module `apps/server/src/modules/assistant/` (thin — no repository of its own, calls into
`reportsService.search`):

- `POST /assistant/query`, gated by `reports:read`. Body: `{ message: string }`.
- Flow: `generateJson` (Ollama) parses `message` into `{ tenderNumber?: string, documentType?:
  TenderDocumentType, freeTextQuery: string }` — same validate-untrusted-LLM-JSON-before-trusting
  pattern as `boq-enrichment.service.ts#parseClassification`. Those hints compose a query string
  handed to the **same** `reportsService.search(businessId, query)` used by `/search` — the
  chatbot is a natural-language front-end over #2, not a second ranking implementation. Reply text
  is composed via `generateText` summarizing the actual results returned (never inventing a
  document that search didn't find); empty results get a canned "Nothing found matching that."

**Frontend:** `/assistant` page — single-thread message list (user messages right-aligned, replies
left-aligned), each reply renders its result set with the exact icon/title/subtitle/href card
markup already in `/search`'s result list (extracted into a small shared component so both pages
render results identically). New sidebar entry in `nav-items.ts` (`{ label: "Assistant", href:
"/assistant", icon: Bot, permission: "reports:read" }`).

### Testing

- Unit (`document-indexing.worker.spec.ts`, hand-written fakes): PDF text extraction, DOCX text
  extraction, unknown-mime-type skip, the ≥8k-char truncation, and the Ollama-down
  log-and-complete path.
- Unit (`reports.repository.spec.ts` additions or a fake-repository service test): metadata-match
  and content-match results both surface, cross-business isolation (same pattern every other
  search entity already proves), dedup when a result matches both ways.
- Integration: upload a PDF attachment → indexing job runs → `GET /search?q=<word from the PDF>`
  returns it. Same for `POST /assistant/query` with a natural-language message referencing a real
  tender number.
- No frontend test for `/assistant`, consistent with this codebase's practice for chat/simple
  pages (matches phase 1's bills pages).

## Scope boundaries

**In:** `Attachment.extractedText`/`embedding`/`embeddedAt` columns, the document-indexing queue
+ worker (enqueued from `attachmentsService.upload`), `searchAttachments` wired into the existing
`/search` endpoint and both frontend surfaces, the new `/assistant` page + `POST
/assistant/query` endpoint, one new feature flag.

**Out, by decision:**

| Deferred | Why |
|---|---|
| OCR / image content search | Filename/type search still covers images; add if it matters |
| Chunked/multi-part retrieval | One embedding per doc is enough at this document length; `ponytail:`-flagged ceiling |
| Conversational memory in `/assistant` | Keeps #3 "retrieval only" simple; add a thread concept later if wanted |
| Content Q&A over document text | Larger commitment (accuracy risk on a small local model); explicitly not asked for |
| A separate `assistant:*` permission | Same read capability as `/search`, reuses `reports:read` |

## Related

- `project_unified_business_folders.md`, this session's phase-1 work — the `Attachment`
  `entityType`/`entityId` convention and the `saveGeneratedTenderDocument` upload path this
  indexing hooks into.
- `packages/database/prisma/schema.prisma`'s `HistoricalRate.embedding` comment — the exact
  precedent this design follows instead of introducing a vector database.
- `apps/server/src/modules/boq/boq-enrichment.service.ts` — the embed/cosine-rank/LLM-classify
  pattern this reuses for both content search and the chatbot's intent parsing.
