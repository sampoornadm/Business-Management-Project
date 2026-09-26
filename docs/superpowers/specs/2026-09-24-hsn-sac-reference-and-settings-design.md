# HSN/SAC reference lookup, scheduled refresh, and a Settings page

## Context

`1400014127`'s BOQ items (35 steel pipe fittings — Tee, Elbow, Bend, Socket, Nipple, Plug) all
carry wrong HSN codes (7308/7309/7310/7311/7318/7321/7322) when every one of them should be
**7307** ("Tube or pipe fittings ... of iron or steel"). Root cause, traced in
`apps/server/src/modules/boq/boq-enrichment.service.ts`: the HSN code is a bare, ungrounded guess
from `qwen3:4b` (`buildPrompt`, "your best-guess Indian HSN code"), validated only for *shape*
(`/^\d{2,8}$/`) never *correctness*, then written straight into the real billing `hsnCode` field
with no confirmation step — unlike category and rate, which are both grounded against real data
and gated behind an explicit human confirm.

The user has downloaded the official CBIC HSN/SAC master list (`HSN_SAC.xlsx`, confirmed genuine —
two sheets, `HSN_MSTR` 21,935 rows / `SAC_MSTR` 681 rows, columns `HSN_CD`/`HSN_Description` and
`SAC_CD`/`SAC_Description`, hierarchical 2/4/6/8-digit codes; `7307` is present verbatim with the
correct description). The same file is available as a plain, unauthenticated, directly-fetchable
download from the GST portal itself: `https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx` (verified
`200 OK`, serves `Last-Modified`/`ETag`, CORS-open, no JS rendering or scraping required — the
`services.gst.gov.in/services/searchhsnsac` URL the user linked is just the page that links to this
file; the actual download needs no interaction with that page at all).

This spec covers three sub-projects, built together per explicit instruction ("make everything
now"): (1) a real HSN/SAC reference table and a matching engine that replaces the ungrounded guess,
(2) a scheduled refresh pipeline for that table, (3) a generic Settings page — RBAC-gated — hosting
the refresh controls plus a first batch of today's env-configured tunables.

## Explicit scope boundaries

- **Matching targets 4-digit HSN headings only** (the `codeLength = 4` rows — 1,348 of them), per
  the user's own instruction. The full 2/6/8-digit hierarchy is still ingested and stored (cheap,
  unlocks deeper drill-down later) but is not part of the matching candidate set yet.
- **GST rate is not fixed by this work.** The CBIC file has no rate data (rates come from separate
  notifications); `gstRatePercent` stays the existing LLM-guess-snapped-to-slab. Only `hsnCode` is
  regrounded.
- **"100% correct" is reframed as "never silently fabricated."** No automated system can guarantee
  legal tax-classification correctness on arbitrary free text. What this design guarantees: the
  suggested code is always one of the ~1,348 real, official 4-digit headings (never an invented or
  wrong-chapter code), and it never reaches the real billing field without an explicit human click.
- **Secrets never move into the new Settings store.** `DATABASE_URL`, `REDIS_URL`,
  `ACCESS_TOKEN_SECRET`, `SMTP_*`, ports, `SEED_USER_PASSWORD` stay env-only, permanently. Only
  non-secret operational tunables (AI thresholds, model names, feature flags, token TTLs — listed
  below) are candidates for the migrated Settings store.

## 1. Reference data

**Schema** (`packages/database/prisma/schema.prisma`):

```prisma
model HsnCode {
  id              String    @id @default(uuid())
  code            String    @unique
  description     String
  codeLength      Int
  embeddingVector Unsupported("vector(1024)")?
  embeddedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([codeLength])
  @@map("hsn_codes")
}

model SacCode {
  id              String    @id @default(uuid())
  code            String    @unique
  description     String
  codeLength      Int
  embeddingVector Unsupported("vector(1024)")?
  embeddedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([codeLength])
  @@map("sac_codes")
}

model ReferenceDataImport {
  id             String   @id @default(uuid())
  dataset        String   // "HSN_SAC"
  sourceUrl      String
  sourceEtag     String?
  hsnRowCount    Int
  sacRowCount    Int
  triggeredById  String?  // null = automated/scheduled
  triggeredBy    User?    @relation(fields: [triggeredById], references: [id], onDelete: SetNull)
  importedAt     DateTime @default(now())

  @@map("reference_data_imports")
}
```

Same `Unsupported("vector(1024)")` + HNSW-cosine-index pattern already used for `Item`/
`HistoricalRate`/`Attachment` (hand-written migration SQL, per the existing pgvector gotcha —
`prisma migrate dev` must not run interactively here; `migrate dev --create-only` + hand-edited SQL
+ `migrate deploy`, same as the BOQ-status-removal migration earlier this session).

**Import pipeline** — one shared service, three entry points:

`apps/server/src/modules/reference-data/hsn-sac-import.service.ts`:
- `importFromBuffer(buffer: Buffer, sourceUrl: string, triggeredById: string | null)`: parses both
  sheets with `exceljs` (already a dependency — no new package), upserts every row into `HsnCode`/
  `SacCode` by `code` (update description if changed, insert if new), embeds only rows that are new
  or whose description changed (`embed()` from the existing Ollama client, batched), writes a
  `ReferenceDataImport` row.
- `fetchAndImport(triggeredById: string | null)`: conditional `GET` against
  `https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx` using the last-stored `ETag`
  (`If-None-Match`); `304` short-circuits to a no-op; otherwise downloads and calls
  `importFromBuffer`.
- A one-off `apps/server/scripts/import-hsn-sac.ts` (`tsx` script, mirrors this repo's other
  one-off scripts like `migrate-tender-folders.ts`) for the initial seed — run once against the
  user's already-downloaded file, or against the live URL.

## 2. Matching engine

Replaces the free-text HSN guess in `boq-enrichment.service.ts#classify`. Same shape as the
category-matching pattern already proven in this codebase (`items.service.ts#suggestForItem`):

1. **Catalog reuse first, unchanged** — `findConfirmedHsn` (exact canonicalName match against a
   human-confirmed `Item`) still wins outright, no re-matching.
2. **ANN retrieval** — embed the BOQ line's description (`bge-m3`, same client), pgvector cosine
   search against `HsnCode` where `codeLength = 4`, top 8 candidates. This is a recall net, not the
   final answer — mirrors `rates.repository.ts#findNearest`'s query shape exactly.
3. **Closed-vocabulary LLM pick** — `qwen3:4b` is given the item description plus the 8 retrieved
   `(code, description)` pairs and a prompt that mirrors `items.helpers.ts#buildClassifyPrompt`:
   must return one of the 8 codes verbatim, or `null`. Anything else (an invented code, a code not
   in the offered set) is rejected in code — same "the model classifies, it never defines the
   vocabulary" rule already documented for category. This is what makes the earlier failure
   (7310/7318/7321/... for a pipe fitting) structurally impossible: the model can only choose among
   codes that were actually retrieved as semantically close by the embedding search over real CBIC
   descriptions, never fabricate one.
4. **Result lands in `suggestedHsnCode`, never `hsnCode`** — this is the confirm-gate fix. Remove
   the existing auto-write branch (`boq-enrichment.service.ts:206`,
   `...(!hsnAlreadyConfirmed && hsnCode !== null ? { hsnCode } : {})`). The real field is only ever
   set by an explicit user action (typing over it, or clicking Apply).

**Frontend** (`apps/web/src/components/boq/boq-item-grid.tsx`): the HSN Code column gains a small
suggestion affordance next to the existing editable input — code + description + an "Apply" button
that calls the existing `commitField(item, "hsnCode", item.suggestedHsnCode)` path (no new mutation
needed, reuses `useUpdateBoqItem`). Same visual language as the existing rate-suggestion
Apply/Reject pair, not a new UI paradigm.

## 3. Scheduled refresh

New BullMQ queue, following the exact pattern `tenderReminderQueue` already establishes in
`apps/server/src/infra/queue/queues.ts` and `apps/server/src/worker.ts` (this repo already has
repeatable jobs — `{ repeat: { pattern: "0 7 * * *" }, jobId: ... }` — this is not new
infrastructure, just a new queue following the existing one):

```ts
export const HSN_SAC_REFRESH_QUEUE_NAME = "hsn-sac-refresh";
export const hsnSacRefreshQueue = new Queue<Record<string, never>, void, "refresh">(
  HSN_SAC_REFRESH_QUEUE_NAME,
  { connection: redis },
);
```

`apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts` calls
`hsnSacImportService.fetchAndImport(null)`. Registered in `worker.ts` with
`{ repeat: { pattern: "0 3 * * 0" }, jobId: "hsn-sac-weekly-refresh" }` (Sundays 03:00) — gated
behind a new `HSN_SAC_AUTO_REFRESH_ENABLED` setting (checked at the top of the worker function, not
by conditionally registering the repeat job, so toggling it in Settings takes effect without a
worker restart).

## 4. Settings infrastructure

**Schema:**

```prisma
model Setting {
  key       String   @id
  value     String   // JSON-encoded
  updatedById String?
  updatedBy User?    @relation(fields: [updatedById], references: [id], onDelete: SetNull)
  updatedAt DateTime @updatedAt

  @@map("settings")
}
```

Plain key-value, JSON-encoded values, matching the "no premature structure" spirit of this
codebase's other polymorphic/generic tables (`Attachment.entityType`/`entityId`,
`AuditLog.entityType`/`entityId`). A typed `SettingKey` union in `@bmp/types` plus a
`SettingsService.get<T>(key, fallback)` / `.set(key, value, actorId)` pair (audit-logs every write
via the existing `AuditService`, same as every other mutation in this app) is the whole backend —
no need for a bespoke table per setting.

`apps/server/src/config/env.ts` reads `Setting` rows as an *override* layer on top of its existing
Zod-validated env defaults, at process boot and on a short TTL cache (settings changing without a
restart is the actual point of moving them out of env) — never as a replacement for the env schema
itself, so a fresh environment with no `Setting` rows yet behaves exactly as it does today.

**First migrated batch** (non-secret operational tunables only):

`TENDER_NOTES_AI_ENABLED`, `AI_ENRICHMENT_ENABLED`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL`,
`OLLAMA_ENRICHMENT_MODEL`, `OLLAMA_BASE_URL`, `AI_MATCH_THRESHOLD`, `AI_CONTEXT_FLOOR`,
`DOCUMENT_MATCH_THRESHOLD`, `LOCAL_DOCS_SYNC_ENABLED`, `INCOMING_TENDERS_INGESTION_ENABLED`,
`DOCUMENT_INDEXING_ENABLED`, `ASSISTANT_TIMEZONE`, `ACCESS_TOKEN_TTL_MINUTES`,
`REFRESH_TOKEN_TTL_DAYS`, `PASSWORD_RESET_TOKEN_TTL_MINUTES`,
`EMAIL_VERIFICATION_TOKEN_TTL_HOURS`, plus the new `HSN_SAC_AUTO_REFRESH_ENABLED`.

**RBAC:** two new permission keys in `packages/types/src/rbac.ts`'s `PERMISSION_KEYS` /
`ROLE_PERMISSION_MATRIX` — `settings:read`, `settings:manage` — assigned to `SUPER_ADMIN` and
`ADMIN` only (SUPER_ADMIN already bypasses via wildcard; `ADMIN` gets both explicitly). Every other
role gets neither. Requires `pnpm db:seed` on every environment after merge, per the existing
"adding a permission key" gotcha already documented in this repo's `CLAUDE.md`.

**Frontend:** `apps/web/src/app/(dashboard)/settings/page.tsx` — a real landing page for the
existing `/settings/*` area (today `roles`, `audit-log`, `sessions` exist as siblings with no
index). Two cards for this spec: "HSN/SAC reference data" (last import timestamp, row counts,
source URL, "Refresh now" button, "Upload file" fallback, auto-refresh toggle) and "System
settings" (the migrated tunables, grouped by the module they affect). Gated by `hasPermission(...,
"settings:read")` for viewing, `"settings:manage")` for editing — mirrors every other permission
check in this app (`apps/web/src/lib/permissions.ts`).

## Testing

- `hsn-sac-import.service.spec.ts`: parses a small fixture buffer (a handful of rows, not the real
  21k-row file), verifies upsert-by-code, verifies unchanged descriptions don't re-embed.
- `boq-enrichment.service.spec.ts` (existing file, extended): the closed-vocabulary rejection case
  (LLM returns a code not in the offered 8 → treated as no match, not stored), the "lands in
  `suggestedHsnCode` only" case (replaces any existing assertion that depended on the old
  auto-write-to-`hsnCode` behavior).
- `settings.service.spec.ts`: get/set round-trip, fallback-to-env-default when no row exists,
  audit-log call on write.
- Integration: `reference-data.integration.spec.ts` — real `fetchAndImport` against a fixture
  server (not the live GST URL, to keep tests offline-safe and fast) asserting the full
  parse-upsert-embed-audit path against the real test Postgres.

## Verification

- `pnpm typecheck` / `pnpm lint` / `pnpm test` across touched workspaces.
- Manually re-run enrichment on tender `1400014127`'s BOQ (re-upload or an admin re-enrich action)
  and confirm all 35 pipe-fitting lines now suggest `7307`, landing in `suggestedHsnCode` with the
  real `hsnCode` field untouched until Applied.
- Manually exercise the Settings page: toggle a tunable, confirm it takes effect without a server
  restart; trigger "Refresh now" and confirm a `ReferenceDataImport` row appears.
