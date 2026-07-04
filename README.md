# Business Management Platform (BMP)

A modular ERP for construction contractors/tendering companies. This repository currently implements:

- **Phase 1: Foundation** — monorepo setup, authentication, RBAC, user management, file uploads, and
  a dashboard shell.
- **Phase 2: Core Tender Management** — tender CRUD with an enforced status workflow, versioned
  document uploads, client organizations, staff assignment, competitor tracking, in-app + email
  notifications, and dashboard widgets.
- **Phase 3: BOQ & Estimation** — Excel/PDF BOQ upload with column-mapping confirmation, versioned
  nested BOQ items with server-computed amounts, bulk rate adjustments, per-item rate-analysis cost
  breakdowns backed by historical material/labor/machinery/transport rates, and cross-tender BOQ
  comparison.
- **Phase 4: Procurement** — vendor management with contacts and performance ratings, an RFQ workflow
  (item sourcing, vendor invitations, quote entry, computed comparative statements, award/close),
  purchase orders (direct or created from an awarded RFQ), partial/multi-delivery goods receipt with
  server-derived status transitions, and post-delivery vendor rating.
- **Phase 5: Project Execution** — converting a WON tender into a project, milestone tracking with
  weighted progress calculation, material/labor consumption logs, progress ("RA") billing with
  server-computed bill amounts, and a costing/progress dashboard combining BOQ estimates, purchase
  order spend, and labor costs against budget.
- **Phase 6: Finance** — bank accounts, GST invoices (standalone or generated from a project's
  progress bill), expenses, a polymorphic payment ledger against invoices/expenses/purchase orders
  with server-derived paid/partially-paid/paid status, and a finance dashboard (receivables,
  payables, cash balance, per-bank-account balances, cash/bank books).
- **Phase 7: Reporting & Intelligence** — five cross-module reports (tender pipeline, procurement
  spend, project costing, financial summary, vendor performance), a KPI dashboard (win rate, BOQ
  turnaround, goods-receipt lead time, receivables DSO), Excel/PDF export for every report, and
  global full-text search across tenders, organizations, vendors, and projects.

See [`spec.md`](./spec.md) for the full product specification and phase roadmap.

## Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, TailwindCSS, shadcn/ui, TanStack Query/Table
- **Backend**: Node.js, Express, TypeScript, Prisma, PostgreSQL, Redis, BullMQ
- **Storage**: PostgreSQL, Redis, S3-compatible object storage (MinIO in development)
- **Infra**: Docker Compose, GitHub Actions, NGINX

## Monorepo layout

```
apps/
  web/            Next.js frontend
  server/         Express API
packages/
  ui/             Shared shadcn/ui component library (@bmp/ui)
  types/          Shared TypeScript DTOs (@bmp/types)
  config/         Shared eslint/tsconfig/tailwind presets (@bmp/config)
  database/       Prisma schema, migrations, seed script (@bmp/database)
infra/
  docker/         nginx config
docker-compose.yml
```

## Prerequisites

- Node.js 20+
- pnpm (`corepack enable pnpm`)
- Docker Desktop (for Postgres, Redis, MinIO, Mailhog, and the reverse proxy)

## First-time setup

```bash
cp .env.example .env       # adjust values if needed
pnpm install
docker compose up -d postgres redis minio minio-init mailhog
pnpm db:migrate             # applies Prisma migrations
pnpm db:seed                # creates roles, permissions, and one sample user per role
pnpm dev                    # runs web (:3000), server (:4000), and the email worker
```

Seeded accounts (password printed by the seed script, default `ChangeMe123!`):

| Role | Email |
|---|---|
| Super Admin | superadmin@bmp.local |
| Admin | admin@bmp.local |
| Tender Manager | tender.manager@bmp.local |
| Estimator | estimator@bmp.local |
| Purchase Manager | purchase.manager@bmp.local |
| Accounts | accounts@bmp.local |
| Project Manager | project.manager@bmp.local |
| Viewer | viewer@bmp.local |

- Web app: http://localhost:3000
- API: http://localhost:4000/api/v1
- API docs (Swagger UI): http://localhost:4000/api/v1/docs
- MinIO console: http://localhost:9001
- Mailhog (dev inbox for invite/reset/verification emails): http://localhost:8025

## Running everything in Docker

```bash
docker compose up -d --build
```

This builds and runs `postgres`, `redis`, `minio` (+ bucket init), `mailhog`, the `server` API, the
`worker` (BullMQ email worker), the `web` frontend, and an `nginx` reverse proxy at
http://localhost:8080. Run `pnpm db:migrate` and `pnpm db:seed` once against the containerized
database before first use (or `docker compose exec server node apps/server/dist/... ` equivalents in
a pure-container workflow).

## Common commands

```bash
pnpm dev             # start web + server + worker in watch mode
pnpm build           # build all apps/packages
pnpm lint            # lint all workspaces
pnpm typecheck       # typecheck all workspaces
pnpm test            # run backend + frontend test suites
pnpm db:migrate      # apply Prisma migrations (dev)
pnpm db:seed         # seed roles/permissions/sample users
```

## Testing

- `apps/server` uses Vitest + Supertest. Unit tests use hand-written fake repositories (no DB
  required). Integration tests (`*.integration.spec.ts`) require a real Postgres/Redis reachable via
  `.env.test` — run `docker compose up -d postgres redis minio minio-init mailhog` first, then apply
  migrations against the test database (`bmp_test`) before running `pnpm --filter @bmp/server test`.

## Architecture notes

- **Auth**: short-lived (15 min) JWT access tokens kept in memory on the client; long-lived (30 day)
  opaque refresh tokens in an httpOnly cookie scoped to `/api/v1/auth`, rotated on every refresh with
  reuse detection (a replayed, already-rotated token revokes the entire session family).
- **RBAC**: eight fixed roles seeded with a resource:action permission matrix, cached per-role in
  Redis and enforced by `requirePermission()` middleware on the server. The frontend mirrors the same
  matrix (`@bmp/types`) purely for UI gating — the server is always the real enforcement point.
  Self-scoped actions (own profile, own avatar, own sessions) skip the permission check entirely.
- **File uploads**: a generic `Attachment` model/API (`/api/v1/attachments`) backed by S3/MinIO,
  reused by the Phase 1 avatar upload flow and intended for every future module's documents (tender
  files, BOQs, purchase orders, etc.) without schema changes.
- **Modules**: the backend is organized as self-contained feature modules
  (`apps/server/src/modules/*`), each with its own routes/controller/service/repository — future
  phases (Vendor, Purchase, Project, Finance) plug in the same way.
- **Tender status workflow**: a strict, single-path transition graph
  (`TENDER_STATUS_TRANSITIONS` in `@bmp/types`) enforced server-side on `PATCH /tenders/:id/status`.
  Every change is written to the existing `AuditLog` (no separate history table) and surfaced via
  `GET /tenders/:id/status-history`.
- **Document versioning**: tender documents reuse the same generic `Attachment` model as avatars —
  re-uploading a document slot (`documentType`, e.g. `BOQ`/`DRAWINGS`) creates a new version in the
  same `documentGroupId` chain and flips the previous version's `isCurrent` flag, rather than forking
  a separate document system.
- **Notifications**: in-app (polled every 30s) plus email for tender assignment and status changes;
  a BullMQ repeatable job (registered on worker boot, `apps/server/src/infra/queue/workers/tender-reminder.worker.ts`)
  scans daily for tenders due in 1/3/7 days and notifies assignees once per threshold.

## Roadmap

See `spec.md` for the full phase list (BOQ & Estimation, Procurement, Project Execution, Finance,
Reporting & Intelligence, Production Readiness) — each will be scoped and built as its own phase on
top of this foundation.
