# BMP — Phase 8 (Production Readiness) Implementation Plan

## Context

Phases 1–7 (all business functionality) are complete and verified. Phase 8 is the spec's final
phase: "Automated testing, performance optimization, security hardening, CI/CD pipelines,
deployment documentation, backup/recovery, monitoring/logging." Unlike Phases 2–7, this phase adds
no business features — it hardens what already exists and fills the operational gaps identified by
an audit of the current codebase (see below), so it's scoped as a checklist against real gaps, not
a generic "best practices" pass.

## Audit: what already exists vs. what's missing

Already in place (confirmed by reading the code, not assumed): `helmet()`, CORS via `env.CORS_ORIGIN`,
a Redis-backed rate limiter on login/refresh/forgot-password, Pino structured logging with secret
redaction + `pino-http` request logging, a global error handler that logs 5xx/4xx appropriately, 51
explicit Prisma `@@index` declarations, an RBAC permission Redis cache, multi-stage production
Dockerfiles for both apps (non-root users, Next `standalone` output), and a working CI workflow
(lint → typecheck → build → test against real Postgres/Redis/MinIO service containers).

Missing / gaps this phase closes:
- No coverage tooling or threshold (backend or frontend); frontend has zero tests despite a Vitest
  config existing.
- No committed E2E suite — all Playwright verification so far has been ad-hoc scratchpad scripts,
  never checked into the repo or run in CI.
- No compression middleware on the API; report endpoints do full-table loads with no caching.
- Rate limiting covers only 3 auth endpoints; no general API-wide limiter; helmet uses defaults with
  no CSP/HSTS tuning; no HTTP parameter pollution guard.
- CI has no dependency audit, no CodeQL, no Dependabot, no Docker build validation.
- Zero backup/recovery tooling or docs for Postgres.
- No production deployment doc beyond local `docker compose up`; no environment-variable reference.
- Health check is a single endpoint with sequential (not parallel) checks and no liveness/readiness
  split; no metrics endpoint for monitoring.

## Scope decisions

- **No new external services requiring credentials/accounts** (no Sentry, Datadog, managed CI
  runners, cloud provider APIs) — everything must run and be verifiable inside this repo/CI with no
  secrets beyond what already exists. Monitoring is a self-hosted-friendly `/metrics` endpoint
  (`prom-client`, scrapeable by any Prometheus instance the deployer chooses to run) plus the
  existing structured JSON logs (already aggregator-ready via Pino) — not a vendor integration.
- **Backup is a script + optional opt-in Docker Compose profile, not a managed backup service.**
  `pg_dump`/`pg_restore` wrapper scripts with retention, runnable via host cron or the optional
  `backup` compose profile — matches the project's Docker Compose deployment model from the spec,
  no new infra dependency.
- **Report caching uses the existing Redis client and TTL pattern already established by the RBAC
  permission cache** (`infra/redis/cache.ts`) — short TTL (60s) on the no-parameter report endpoints
  (kpis, tender-pipeline, vendor-performance) rather than restructuring the aggregation queries
  themselves; consistent with "computed read" but acknowledges these are read-heavy dashboard
  endpoints that don't need per-request freshness.
- **E2E suite is a proper Playwright project under `apps/web/e2e/`**, distilled from the ad-hoc
  verification scripts already proven to work in this session (login, tenders, reports/search),
  wired into CI as a job that boots the real stack (Postgres/Redis/MinIO + built server + built web)
  — not a duplicate of the unit/integration suites, covers real user flows across page boundaries.
- **CI/CD additions are validated locally for correctness (YAML structure, script logic) since this
  session does not push to the remote** (no commits/pushes without being asked, per standing
  practice) — the user can review and push when ready.

## Backend changes

- `apps/server/src/app.ts`: add `compression()` middleware; tune `helmet()` with an explicit CSP
  (API serves JSON only, so a locked-down `default-src 'none'` policy) and HSTS in production; add
  `hpp()` for parameter-pollution protection; add a general API-wide rate limiter (higher ceiling
  than the auth-specific ones, applied after them so auth keeps its stricter limits).
- `apps/server/src/infra/redis/cache.ts`: add generic `getCachedJson`/`setCachedJson` helpers
  (key, ttl) reusing the existing Redis client, used by the reports service for the three
  no-parameter report endpoints.
- `apps/server/src/routes/health.ts`: split into `GET /health/live` (process is up, no dependency
  checks — for container liveness probes) and `GET /health/ready` (parallelized Postgres/Redis/S3 +
  new BullMQ queue check — for readiness probes / the existing dashboard widget). Keep `GET /health`
  as an alias to `/health/ready` for backward compatibility with the existing frontend dashboard hook.
- New `apps/server/src/routes/metrics.ts`: `prom-client` default metrics (process/GC/event-loop) +
  an HTTP request duration histogram middleware registered in `app.ts`, exposed at `GET /metrics`
  (no auth — standard Prometheus scrape convention; not under `/api/v1`).
- `packages/database` / `infra/scripts/`: `backup-db.sh` (pg_dump with timestamped filename +
  retention pruning) and `restore-db.sh` (restore from a named dump, confirmation prompt).

## Frontend changes

- `apps/web/e2e/`: new Playwright project — `playwright.config.ts` (webServer config pointing at
  `next start` against the already-built app, or `next dev` for local iteration), `auth.spec.ts`
  (login/logout, unauthenticated redirect), `reports-and-search.spec.ts` (reports dashboard tabs +
  export download + global search), `tenders.spec.ts` (create a tender, change status, verify it
  appears in the list) — each a cleaned-up version of a scratchpad script already proven to work.
- A handful of real unit tests for previously-untested frontend logic: `lib/permissions.spec.ts`
  (`hasPermission` truth table), `lib/api.spec.ts` (`unwrap` success/error paths).

## CI/CD changes

- `.github/workflows/ci.yml`: add a coverage step (`vitest run --coverage`) with a threshold that
  matches actual current coverage (not an arbitrary aspirational number), add `pnpm audit
  --audit-level=high`, add a Docker build validation step (`docker build` for both Dockerfiles, no
  push — no registry secret exists), add a Playwright job (separate job in the same workflow,
  service containers + build + `next start` + `playwright test`).
- New `.github/workflows/codeql.yml`: CodeQL analysis for JavaScript/TypeScript on push/PR + weekly
  schedule.
- New `.github/dependabot.yml`: weekly npm (root + each workspace) and github-actions ecosystem
  update checks.

## Documentation

- `docs/deployment.md`: production deployment guide — building images, environment setup, TLS
  termination at nginx (cert placement, redirect-to-HTTPS server block), zero-downtime redeploy
  notes (`docker compose up -d --no-deps --build <service>`), scaling notes (stateless server/web,
  BullMQ worker can run multiple replicas).
- `docs/environment-variables.md`: every env var from `.env.example` in a table — purpose,
  required/optional, sensitive Y/N, production guidance (e.g. "`ACCESS_TOKEN_SECRET` — generate with
  `openssl rand -hex 32`, never reuse the dev placeholder").
- `docs/backup-recovery.md`: what's backed up (Postgres only — S3/MinIO objects are the deployer's
  existing object-storage backup responsibility, out of scope), backup schedule/retention, restore
  procedure, RPO/RTO expectations for a system this size.

## Testing

Backend: unit tests for the new `getCachedJson`/`setCachedJson` cache helpers and for the
liveness/readiness health split (fake Prisma/Redis/S3 clients, same style as existing tests). No new
integration test needed for `/metrics` beyond a smoke assertion (200 + `# HELP` prefix in body) — it
has no business logic. Frontend: the two new unit test files above, plus the three Playwright E2E
specs run against a fully seeded local stack.

## Build order

1. Backend hardening: compression, tuned helmet, hpp, general rate limiter
2. Report caching helpers + wiring into the three no-parameter reports
3. Health check split + metrics endpoint, with unit tests
4. Backup/restore scripts
5. Frontend unit tests (permissions, api unwrap)
6. Playwright E2E project + 3 specs, run locally against the dev stack
7. CI workflow updates (coverage, audit, Docker build validation, Playwright job) + CodeQL +
   Dependabot config
8. Deployment/environment-variables/backup-recovery docs
9. Full monorepo `lint`/`typecheck`/`build`/`test` + run the new Playwright suite end-to-end

## Verification

- `pnpm lint && pnpm typecheck && pnpm build && pnpm turbo run test` clean across the whole monorepo,
  coverage report generated for both `apps/server` and `apps/web`.
- `GET /health/live` and `/health/ready` both return correctly; `GET /metrics` returns Prometheus
  text format.
- `infra/scripts/backup-db.sh` produces a real dump against the local dev Postgres;
  `restore-db.sh` restores it into a scratch database and the row counts match.
- Playwright E2E suite passes locally against the real running stack (not mocked).
- `docker build` succeeds for both `apps/server/Dockerfile` and `apps/web/Dockerfile`.

## Critical files (once built)

- `apps/server/src/app.ts` (compression/helmet/hpp/rate-limit wiring)
- `apps/server/src/routes/health.ts`, new `apps/server/src/routes/metrics.ts`
- `apps/server/src/infra/redis/cache.ts`
- `apps/web/e2e/*.spec.ts`, `apps/web/playwright.config.ts`
- `.github/workflows/ci.yml`, new `.github/workflows/codeql.yml`, new `.github/dependabot.yml`
- `infra/scripts/backup-db.sh`, `infra/scripts/restore-db.sh`
- `docs/deployment.md`, `docs/environment-variables.md`, `docs/backup-recovery.md`

This is the eighth and final phase per `spec.md`'s roadmap. No further phases follow.

## Pre-existing Dockerfile bugs found and fixed while verifying the `docker-build` CI job

Neither Dockerfile had ever actually been built or run end-to-end before this phase (confirmed by
the Phase 8 audit — no CI step, no manual note anywhere). Adding the CI `docker-build` job and
smoke-testing it surfaced two real, independent, production-blocking bugs:

1. **No `.dockerignore` existed.** `COPY packages ./packages` / `COPY apps/server ./apps/server` in
   each Dockerfile's `build` stage pulled the *host's* locally pnpm-installed `node_modules`
   (real files/symlinks resolved against the host's `.pnpm` store) into the build context, silently
   clobbering the image's own freshly-`pnpm install`-ed `node_modules` from the `deps` stage —
   breaking module resolution (`prisma generate` failing with `MODULE_NOT_FOUND`). Added
   `.dockerignore` at the repo root. **Non-obvious gotcha**: unlike `.gitignore`, a bare
   `node_modules/` pattern in `.dockerignore` only matches a *top-level* path — it does not
   recurse into nested paths like `packages/*/node_modules`. Every exclusion needs an explicit
   `**/` prefix (`**/node_modules/`) to actually apply throughout a monorepo.
2. **The `deps` stage only copied a subset of workspace `package.json` files** (e.g. the server
   Dockerfile never copied `packages/ui/package.json` or `apps/web/package.json`). `pnpm install
   --frozen-lockfile` needs every workspace member's manifest present to resolve the lockfile's
   full dependency graph deterministically — a partial set produced a different (and broken)
   `.pnpm` virtual-store layout than a full-workspace install would. Fixed by copying all six
   workspace manifests in both Dockerfiles' `deps` stage, regardless of which app is actually built.
3. **The runner stage ran compiled output via plain `node`**, but `@bmp/database` (like
   `@bmp/types`/`@bmp/ui`) is an intentionally unbuilt raw-TS workspace package — `tsc` compiles
   `apps/server`'s own code but leaves `import ... from "@bmp/database"` pointing at raw `.ts`
   source, which plain `node` cannot load (`Unknown file extension ".ts"`). Fixed by running the
   production server/worker via `tsx` (the same loader `pnpm dev` already uses successfully) instead
   of plain `node` — updated both Dockerfiles' `CMD`, `docker-compose.yml`'s `worker` service
   `command`, and `apps/server/package.json`'s `start`/`worker:start` scripts.

Verified after the fix: both `docker build`s succeed from a clean `--no-cache` build, and the built
server image was smoke-tested with `docker run` against the real `docker-compose` Postgres/Redis/
MinIO — `GET /health/ready` returned all four checks (`postgres`, `redis`, `s3`, `queue`) healthy.

## Known follow-up (not fixed in this phase)

`pnpm audit --audit-level=high` currently reports 9 high + 1 critical findings, all requiring
**major** version bumps to remediate (`nodemailer` 6→9, `vitest` 2→3, plus transitive `vite`/`tar`).
Per this project's established convention (see the `pdf-parse` gotcha in `CLAUDE.md` — don't
"helpfully" upgrade a working, tested dependency across a major version without dedicated
regression testing), these were deliberately left alone rather than bumped as a drive-by fix within
an unrelated hardening pass. The `dependency-audit` CI job runs with `continue-on-error: true` so it
reports findings without blocking the pipeline; flip it to blocking once these are triaged and
upgraded with real regression testing (nodemailer's bump in particular changes major API surface
used by the email queue).
