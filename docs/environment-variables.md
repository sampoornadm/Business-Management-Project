# Environment Variables Reference

Every variable below lives in `.env` at the repo root (copy `.env.example` to start).
`docker-compose.yml`, the server, and the web app all read from this one file in local dev; in
production, inject the same names via your host/orchestrator's secret/config mechanism instead of
committing a `.env` file (see [`deployment.md`](./deployment.md)).

**Sensitive** = must be a strong, unique, rotated-per-environment value in production, never the
dev placeholder committed in `.env.example`.

## Postgres

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `POSTGRES_USER` | Yes | No | Also used by `infra/scripts/backup-db.sh`/`restore-db.sh`. |
| `POSTGRES_PASSWORD` | Yes | **Yes** | |
| `POSTGRES_DB` | Yes | No | |
| `POSTGRES_PORT` | No (default `5432`) | No | Host-side port mapping only; irrelevant if Postgres is a managed service. |
| `DATABASE_URL` | Yes | **Yes** | Prisma connection string. Must match the four vars above when using the bundled `docker-compose` Postgres. |

## Redis

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `REDIS_PORT` | No (default `6379`) | No | Host-side port mapping only. |
| `REDIS_URL` | Yes | No* | *Mark sensitive if your Redis requires auth (`redis://:password@host:port`) — the bundled dev Redis has none. Used for sessions/rate-limiting/caching and as the BullMQ connection. |

## Object storage (S3-compatible / MinIO)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `MINIO_ROOT_USER` | Dev only | **Yes** | Only relevant when running the bundled MinIO container. |
| `MINIO_ROOT_PASSWORD` | Dev only | **Yes** | |
| `MINIO_PORT` / `MINIO_CONSOLE_PORT` | No | No | Host-side port mappings only. |
| `S3_ENDPOINT` | Yes | No | Point at AWS S3 or any S3-compatible provider in production. |
| `S3_REGION` | Yes | No | |
| `S3_ACCESS_KEY_ID` | Yes | **Yes** | |
| `S3_SECRET_ACCESS_KEY` | Yes | **Yes** | |
| `S3_BUCKET` | Yes | No | A `<S3_BUCKET>-test` bucket must also exist for running integration tests. |
| `S3_FORCE_PATH_STYLE` | Yes | No | `true` for MinIO; set `false` for AWS S3 (virtual-hosted-style URLs). |

## SMTP (email)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `SMTP_HOST` | Yes | No | Mailhog in dev; a real provider (SES, SendGrid, etc.) in production. |
| `SMTP_PORT` | Yes | No | |
| `SMTP_FROM` | Yes | No | Display name + address used as the `From:` header. |
| `MAILHOG_WEB_PORT` | Dev only | No | Mailhog's web UI port; irrelevant once a real SMTP provider is configured. |
| `SMTP_USER` / `SMTP_PASSWORD` | Only if your provider requires auth | **Yes** | Not read by the bundled dev Mailhog; add if your production SMTP provider needs credentials (check `apps/server/src/config/env.ts` before assuming — extend the schema there if your provider needs them). |

## Server

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `SERVER_PORT` | No (default `4000`) | No | |
| `API_BASE_PATH` | No (default `/api/v1`) | No | |
| `CORS_ORIGIN` | Yes | No | Must exactly match the web app's public origin in production (e.g. `https://app.example.com`). |
| `ACCESS_TOKEN_SECRET` | Yes | **Yes** | JWT signing secret. Generate with `openssl rand -hex 32`. Rotating it invalidates every live session. |
| `ACCESS_TOKEN_TTL_MINUTES` | No (default `15`) | No | |
| `REFRESH_TOKEN_TTL_DAYS` | No (default `30`) | No | |
| `REFRESH_TOKEN_COOKIE_NAME` | No | No | |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | No (default `60`) | No | |
| `EMAIL_VERIFICATION_TOKEN_TTL_HOURS` | No (default `48`) | No | |
| `WEB_APP_URL` | Yes | No | Used to build links in emails (invite/reset/verify). Must be the public web URL in production. |
| `SEED_USER_PASSWORD` | Dev/CI only | **Yes** | Password assigned to all seeded demo users (`pnpm db:seed`). **Never run the seed script against a production database** — it's for local dev and CI fixtures only. |
| `BACKUP_RETENTION_DAYS` | No (default `14`) | No | Read by `infra/scripts/backup-db.sh`. |
| `BUSINESSES_ROOT_DIR` | No (default `~/BMP-Businesses`) | No | One root, one subfolder per business (keyed by `Business.code`): `<code>/templates/` (document-generation `.docx` templates — must be a plain `.docx`, not `.dotx`: if built from a `.dotx` letterhead starter in Word, use File > Save As > Word Document first) and `<code>/tenders/` (the tender-document auto-import folders, opt-in via `LOCAL_DOCS_SYNC_ENABLED`). No upload UI — place files directly. |
| `INCOMING_TENDERS_INGESTION_ENABLED` | No (default `false`) | No | Separate opt-in from `LOCAL_DOCS_SYNC_ENABLED`: watches `<code>/incoming-tenders/` (under `BUSINESSES_ROOT_DIR`) and auto-creates a DRAFT `Tender`/`Organization`/`Boq` from a dropped `.pdf`/`.docx` with zero human review. `LOCAL_DOCS_SYNC_ENABLED` only attaches files onto an *existing* tender — enabling that flag does not imply this one, and vice versa. |

## Ollama (local LLM — tender document auto-extraction, AI tender intelligence)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `OLLAMA_BASE_URL` | No (default `http://localhost:11434`) | No | Used by the "extract from document" upload on the New Tender page and by AI enrichment. Requires `ollama serve` running locally with the configured models pulled. If the server/worker runs inside Docker, use `http://host.docker.internal:11434` to reach an Ollama instance on the host — `docker-compose.yml` already sets this for both. |
| `OLLAMA_MODEL` | No (default `llama3.1:8b`) | No | Tender document extraction only. Pull with `ollama pull llama3.1:8b`. If unreachable/misconfigured, the upload returns a clear error — no other functionality is affected. |

## AI tender intelligence (optional)

Enriches committed BOQ items in the background: normalized name, category/subcategory, and — only
where the item is provably the same as one already priced — a suggested rate from `HistoricalRate`.
Entirely local, CPU-only, no GPU required. Roughly 3s per line item, so a typical 10-15 item tender
finishes in well under a minute.

Every BOQ path works identically with this disabled or with Ollama simply not running: when the
worker can't reach Ollama it logs a warning and completes the job, leaving the item's `ai*` columns
null. AI never writes to estimator-entered fields — suggestions land in separate `ai*` columns and
the grid offers an explicit "Apply".

Setup: `ollama pull bge-m3 && ollama pull qwen3:4b`, then set `AI_ENRICHMENT_ENABLED=true`.

### Low-memory machines (8GB)

The default stack needs ~3.7GB resident for models alone (`qwen3:4b` 2.5GB + `bge-m3` 1.2GB). On an
8GB box — after Windows (~3-4GB), Docker Desktop/WSL2 (~2GB) and Node — that does not fit. Do
**not** reach for parallelism to compensate: measured on CPU, running 4 items concurrently gained
**1.16x**, because inference already saturates every core on a single request. It costs RAM (a KV
cache per slot) and buys nothing. Serial already meets the 60s/tender budget (~3s per item).

Two config-only downgrades, no code change. Both were measured against `examples/RFx 1400012609.PDF`:

| Swap | Models RAM | Cost |
|---|---|---|
| `OLLAMA_EMBED_MODEL=nomic-embed-text` (274MB, replaces bge-m3) | 2.8GB | None found. Its near-miss margin below `AI_MATCH_THRESHOLD` measured *wider* than bge-m3's (0.077 vs 0.041), i.e. slightly safer. Tested on one family of items only — re-measure on your own before trusting it broadly. |
| also `OLLAMA_ENRICHMENT_MODEL=qwen3:1.7b` (1.4GB, replaces qwen3:4b) | 1.7GB | Drops `aiSubcategory` entirely (always null) and mangles `normalizedName` (`"TUBE POLYURETHANE 5/5.5 ID 8 MM..."` — loses the OD marker). Category accuracy held up. 1.65x faster. |

Neither swap affects **rate safety**: a suggested rate requires `AI_MATCH_THRESHOLD` + identical
numeric specs + matching unit, and the numeric-spec guard reads the raw description, not the model's
output. Changing `OLLAMA_EMBED_MODEL` **does** invalidate stored embeddings — clear
`HistoricalRate.embeddedAt` to force a re-embed — and requires re-deriving `AI_MATCH_THRESHOLD`.

Also set `OLLAMA_KEEP_ALIVE=60s` (default 5m) so Ollama releases model RAM between tenders, and keep
the enrichment worker at `concurrency: 1`.

**What it will and won't do.** Classification and normalization run on every item and are the
reliable part. A *rate* is only suggested when all three of these agree: cosine ≥
`AI_MATCH_THRESHOLD`, identical numeric specs, and a matching unit. This is deliberately strict —
measured, neither the embedding nor the model can tell "XLPE Cable 4C x16" from "…x25" or from
"PVC Cable 4C x16", and a wrong unit rate in a live bid is far more expensive than a blank cell. A
loosely-worded restatement of a known item will get a category but no rate; use the existing manual
historical-rate lookup for those.

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `AI_ENRICHMENT_ENABLED` | No (default `false`) | No | Master switch. When false, nothing is queued and the enrichment worker never starts. |
| `OLLAMA_EMBED_MODEL` | No (default `bge-m3`) | No | Embedding model for similarity search. `bge-m3` is what Ollama ships (BGE-Small has no official Ollama image and would need a custom Modelfile). Changing this invalidates existing embeddings **and the calibrated thresholds below** — clear `HistoricalRate.embeddedAt` to force a re-embed, and re-measure. |
| `OLLAMA_ENRICHMENT_MODEL` | No (default `qwen3:4b`) | No | Classification model. Called for every item; it names and categorises, it never prices. |
| `AI_MATCH_THRESHOLD` | No (default `0.98`) | No | Cosine similarity required before a historical rate can be suggested. Calibrated for `bge-m3`: a same-item restatement measures 0.989, but a 10x spec difference ("x16" vs "x1.6") still measures 0.948 — hence 0.98, not 0.95. |
| `AI_CONTEXT_FLOOR` | No (default `0.75`) | No | Retrieval floor: candidates below this aren't shown to the LLM as category context. Unrelated trades measure 0.31-0.38, same-trade items 0.84+. |

## Web (Next.js)

| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | No | Baked into the client bundle at build time — must point at the API's public URL before `next build` runs in production (rebuild the image if this changes). |
| `WEB_PORT` | No (default `3000`) | No | |

## Production checklist

Before deploying anywhere beyond local dev:

1. Generate fresh, unique values for every row marked **Sensitive** above — never reuse a value
   from `.env.example`.
2. Set `S3_FORCE_PATH_STYLE=false` if using real AWS S3 (not MinIO).
3. Set `CORS_ORIGIN` and `WEB_APP_URL` to your real public web origin (both must use `https://`).
4. Do not set `NODE_ENV` yourself — `next build`/`next start` and `tsc`/`tsx` each set it correctly
   for their own step; forcing it breaks `next build` (see the comment at the top of `.env.example`).
