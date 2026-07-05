# Business Management Platform (BMP)

ERP for a construction contractor/tendering company, built incrementally per `spec.md`'s 8-phase
roadmap. **All 8 phases are complete and verified**: Foundation, Core Tender Management, BOQ &
Estimation, Procurement, Project Execution, Finance, Reporting & Intelligence, and Production
Readiness. Plans for each phase live in `.claude/plans/` (`phase-1-foundation.md`,
`phase-2-tenders.md`, `phase-3-boq-estimation.md`, `phase-4-procurement.md`,
`phase-5-project-execution.md`, `phase-6-finance.md`, `phase-7-reporting.md`,
`phase-8-production-readiness.md`). Production deployment/environment/backup docs live in `docs/`.

## Stack

Next.js 15 (App Router) + React 19 + TypeScript + TailwindCSS + shadcn/ui + TanStack Query/Table,
Zustand · Express + TypeScript + Prisma + PostgreSQL + Redis + BullMQ · S3-compatible storage
(MinIO in dev) · pnpm + Turborepo monorepo · Docker Compose · GitHub Actions.

## Layout

```
apps/web/         Next.js frontend (App Router, route groups: (auth), (dashboard))
apps/server/      Express API (feature-based modules under src/modules/*)
packages/ui/      Shared shadcn/ui component library (@bmp/ui) — no build step, raw TS source
packages/types/   Shared DTOs + RBAC permission matrix (@bmp/types)
packages/config/  Shared eslint/tsconfig/tailwind presets (@bmp/config)
packages/database/ Prisma schema, migrations, seed (@bmp/database)
```

## Commands

```bash
pnpm dev             # web (:3000) + server (:4000) + BullMQ worker, watch mode
pnpm build / lint / typecheck / test   # across all workspaces via Turborepo
pnpm db:migrate      # prisma migrate dev (uses root .env)
pnpm db:seed         # idempotent: roles/permissions/sample users from @bmp/types' matrix
docker compose up -d # postgres, redis, minio(+init), mailhog, nginx
```

Seeded users (password `ChangeMe123!`): `superadmin@bmp.local`, `admin@bmp.local`,
`tender.manager@bmp.local`, `estimator@bmp.local`, `purchase.manager@bmp.local`,
`accounts@bmp.local`, `project.manager@bmp.local`, `viewer@bmp.local`.

## Conventions (follow exactly — every module in this repo does)

**Backend module** (`apps/server/src/modules/<name>/`): `*.repository.ts` (thin Prisma wrapper,
`I<Name>Repository` interface + class), `*.service.ts` (business logic, constructor-injected
repos — plain `new`, no DI container), `*.controller.ts` (thin, `asyncHandler` + `sendSuccess`),
`*.routes.ts` (`authenticateMiddleware` + `requirePermission('resource:action')` + `validate(zod)`
per route, `@openapi` JSDoc for swagger-jsdoc), `*.validation.ts` (Zod), `*.mapper.ts` (entity→DTO,
async when it needs presigned S3 URLs), `*.module.ts` (composition root: wires everything, exports
router + any singleton other modules need — see how `tenders.module.ts` imports
`usersRepository`/`organizationsRepository` etc. from sibling modules to avoid re-instantiating).

**RBAC**: permission keys are `resource:action` strings in `packages/types/src/rbac.ts`
(`ROLE_PERMISSION_MATRIX`). Adding a permission = add the key + assign it to roles there; the seed
script picks it up idempotently — no migration needed. Self-scoped routes (own profile/avatar/
sessions) skip `requirePermission` entirely and check ownership in the service instead.

**Generic infra — reuse, don't fork**: `AttachmentsService` (`modules/attachments/`) is the one file
upload system for every entity (`entityType`/`entityId` columns); it already supports versioned
document slots (`documentType`, `documentGroupId`, `isCurrent`) as used by tender documents.
`AuditService.log(...)` is the one event log for every module — status-history-style views are just
filtered reads of `AuditLog`, not new tables (see `tenders.service.ts#getStatusHistory`).

**Frontend**: TanStack Query hooks in `apps/web/src/hooks/use-*.ts` wrap `apps/web/src/lib/axios.ts`
(auto-refreshes JWT on 401, single in-flight refresh). Pages live under
`apps/web/src/app/(dashboard)/*/page.tsx`; gate UI with `hasPermission(roleName, 'resource:action')`
from `apps/web/src/lib/permissions.ts` (mirrors the same matrix — server is still the real
enforcement point). `packages/ui` components must stay domain-agnostic (no "tender"/"user" strings
in there) so every future module reuses the same DataTable/Form/Tabs/Stepper/MultiSelect/etc.

**Money/dates**: tender monetary fields are `Float` in Prisma, not `Decimal` — deliberate, revisit
when Phase 6 (Finance) designs real ledger precision. Numeric form fields are kept as plain strings
in React Hook Form state (converted at submit time) — avoids RHF+zodResolver's 3-generic
input/output typing friction with `.transform()` schemas.

**Testing**: Vitest (not Jest). Unit tests use hand-written fake repositories implementing the
`I<Name>Repository` interface — no mocking framework. Integration tests (`*.integration.spec.ts`)
hit the real Express app via supertest against a real test Postgres (`.env.test`, database
`bmp_test`) — require `docker compose up` + migrations applied to that DB first. Any integration test
that uploads a file needs the `<S3_BUCKET>-test` MinIO bucket (created by `minio-init`, see gotchas).

**Versioned parent+children entities** (`Boq`/`BoqItem`, mirrors `Attachment`): a `groupId` self-
reference where version 1 points at its own id (`groupId = id`), plus `version`/`isCurrent` columns.
"All versions" is always `WHERE groupId = X`; committing a new version marks prior rows not-current
in the same transaction. Nested trees (`BoqItem.parentId`/`children`) are fetched as a flat list
ordered by `sortOrder` and assembled into a tree in the mapper — never a recursive Prisma `include`.
`packages/ui`'s `EditableTreeTable` is the generic component for rendering/editing that shape
(inline-editable cells, row selection, expand/collapse) and is meant to be reused by future
line-item grids (e.g. Purchase Order items), not forked.

**Polymorphic references** (`Payment.entityType`/`entityId` against `Invoice`/`Expense`/
`PurchaseOrder`): same generic-reference convention as `Attachment.entityType`/`entityId` and
`AuditLog.entityType`/`entityId` — an unenforced (no FK) pair of columns rather than three nullable
FK columns or three separate tables. Status fields on the referenced entity (`Invoice.status`,
`Expense.status`) are server-derived by comparing `Σ Payment.amount` for that entity against its
total — never trust a client-sent status, same "recompute on read" rule as BOQ amounts and PO
receiving status.

## Gotchas already solved here (don't rediscover)

- Turborepo strips env vars from tasks by default → root `turbo.json` sets `"envMode": "loose"`.
- Don't put `NODE_ENV` in root `.env` — breaks `next build` (needs to self-set `production`).
- `@bmp/types`/`@bmp/ui` are unbuilt raw-TS packages; Next's webpack needs `resolve.extensionAlias`
  (`.js` → also try `.ts`/`.tsx`) — already configured in `apps/web/next.config.mjs`.
- `next/core-web-vitals` (via FlatCompat) clobbers the typescript-eslint parser for every file if
  spread before it — our `packages/config/eslint/nextjs.js` deliberately spreads it *first*.
- MinIO's `minio-init` service only creates the dev bucket by default; `docker-compose.yml` now also
  creates `<S3_BUCKET>-test` for integration tests that upload files (BOQ parse, tender documents).
  If a fresh clone's integration tests 500 on upload, re-run `docker compose up -d minio-init`.
- `pdf-parse` v2 is a heavy pdfjs-based rewrite (canvas/worker deps) with a different class API;
  we deliberately pinned `pdf-parse@1.1.4` (simple `pdfParse(buffer) -> {text}`) since BOQ PDF
  extraction is explicitly best-effort — don't "helpfully" upgrade it.
- Repeatedly re-running integration tests against the same Redis burns through the login rate
  limiter (`RATE_LIMITS.LOGIN`) and integration tests will start failing with 429s that look like
  real bugs. `docker compose exec redis redis-cli FLUSHALL` before a fresh run if that happens.
- `pnpm --filter @bmp/web dev`, `build`, and `typecheck` all read/write `apps/web/.next` — running
  `build`/`typecheck` while the dev server is up (or running them concurrently via `turbo run`) races
  on that directory and produces bogus `TS6053: File '.next/types/...' not found` errors. Stop the
  dev server (or just run `build` then `typecheck` sequentially, never in the same turbo pipeline)
  before trusting a typecheck failure that only mentions `.next/types`.
- A Radix `<Select value={x}>` only shows its `placeholder` when `value` is `undefined`/`""` —
  seeding it with a sentinel like `"__none__"` that has no matching `<SelectItem>` renders **blank**
  instead (looks broken, no error thrown). Only use the sentinel pattern when you also add a
  `<SelectItem value="__none__">` for it (see the tender-picker selects in `rfqs/new`/
  `purchase-orders/new`); otherwise just bind directly to the empty-string state.
- shadcn `Badge` renders a `<div>` — never nest it inside a `<p>` (invalid HTML → React hydration
  warning). Wrap the label+badge pair in a `<div>` instead.
- `.dockerignore` is **not** `.gitignore` syntax: a bare `node_modules/` only matches a top-level
  path, it does NOT recurse into `packages/*/node_modules` in a monorepo — every pattern needs an
  explicit `**/` prefix (`**/node_modules/`) or nested node_modules dirs get copied into the Docker
  build context and clobber the image's own `pnpm install` output (`prisma generate` failing with
  `MODULE_NOT_FOUND` is the symptom). Also: a Dockerfile's `deps` stage must `COPY` **every**
  workspace member's `package.json` (not just the ones that specific image builds) before `pnpm
  install --frozen-lockfile` — a partial manifest set resolves a different, broken `.pnpm`
  virtual-store layout than the lockfile expects.
- `@bmp/database` (like `@bmp/types`/`@bmp/ui`) is an intentionally unbuilt raw-TS workspace
  package. Production containers must run the server/worker via `tsx` (`apps/server/package.json`'s
  `start`/`worker:start` scripts, and both Dockerfiles' `CMD`), never plain `node dist/index.js` —
  plain `node` can't load the `.ts` files that `import ... from "@bmp/database"` resolves to
  (`Unknown file extension ".ts"`).
- The New Tender page's "extract from document" upload (`tender-extraction.service.ts`) is the
  only part of this app with an LLM dependency — it calls a **local** Ollama instance
  (`OLLAMA_BASE_URL`/`OLLAMA_MODEL`, see `environment-variables.md`), not a hosted API. No key, no
  cost. If Ollama isn't running, the upload returns a clear `ServiceUnavailableError`; every other
  tender-creation path (manual entry, `POST /tenders`) is completely unaffected.
- `docker compose up -d` with no service names starts **everything** in `docker-compose.yml`,
  including the containerized `server`/`web`/`worker`/`nginx` app images — not just the infra
  services (postgres/redis/minio/mailhog). Local day-to-day dev uses `pnpm dev` (tsx/next running
  directly on the host) instead, so running a bare `docker compose up -d` alongside `pnpm dev`
  double-starts the app and both instances race for ports 3000/4000. This also silently breaks the
  Ollama tender-extraction feature: a containerized server can't reach the host's Ollama via
  `localhost` (needs `host.docker.internal`), so it fails with a confusing `SERVICE_UNAVAILABLE`
  even when Ollama is running fine on the host. If you only need infra for `pnpm dev`, run
  `docker compose up -d postgres redis minio minio-init mailhog` instead.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
