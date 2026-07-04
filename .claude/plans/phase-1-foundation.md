# BMP — Phase 1 (Foundation) Implementation Plan (reconstructed)

> Reconstructed from conversation memory after the original file was overwritten in place when
> Phase 2 planning began (plan-mode reuses one file per session slug). Reflects what was actually
> approved and built; matches the shipped code in this repo.

## Context

The user wants to build a full-scale ERP ("Business Management Platform") for a construction
contractor/tendering company, replacing spreadsheets. The full spec spans 8 phases and explicitly
forbids building it all in one pass — delivered incrementally, phase by phase, each phase fully
functional with no placeholders/TODOs. This plan covers **Phase 1: Foundation** — monorepo, Docker
infra, auth, RBAC, user management, file uploads, logging, and the dashboard/UI shell. Every later
phase plugs into this foundation as a self-contained module.

Confirmed tooling: **pnpm + Turborepo** monorepo, Next.js 15 (App Router) + React 19 + TypeScript +
Tailwind + shadcn/ui frontend, Express + TypeScript + Prisma + PostgreSQL backend, Redis + BullMQ,
MinIO (S3-compatible) for file storage, Docker Compose for local infra, GitHub Actions for CI.

## Monorepo Layout

```
apps/
  web/            Next.js 15 App Router frontend
  server/         Express API
packages/
  ui/             shadcn/ui-based shared component library
  types/          Shared TS DTOs (User, Role, Permission, Attachment, ApiResponse<T>, PaginatedResult<T>)
  config/         Shared eslint/tsconfig/tailwind presets
  database/       Prisma schema + migrations + seed.ts, exported as @bmp/database
infra/
  docker/         nginx config
docker-compose.yml
```

## Backend Architecture (`apps/server/src`)

Feature-based module folders are the primary axis; Clean Architecture layers live inside each module
(`*.routes.ts` = presentation, `*.service.ts` = application, `*.repository.ts` = domain/infra
boundary). Plain constructor-injection composition roots (`*.module.ts`) — no DI container.

```
apps/server/src/
  config/env.ts (zod-validated), config/constants.ts
  core/errors/ (AppError + HttpErrors)
  core/interfaces/ (pagination, generic IRepository<T>)
  core/response/ApiResponse.ts
  modules/
    auth/ users/ roles/ permissions/ attachments/ audit/
  shared/
    middleware/ (authenticate, requirePermission, validate, requestId, rateLimiter, errorHandler, asyncHandler)
    logger/ (pino), utils/ (hash, pagination, tokens)
  infra/
    prisma/, redis/, queue/ (BullMQ), storage/ (S3/MinIO + sharp), mailer/
  docs/swagger.ts
  routes/v1.router.ts
```

## Prisma Schema (Phase 1 models)

`User`, `Role` (fixed: SUPER_ADMIN, ADMIN, TENDER_MANAGER, ESTIMATOR, PURCHASE_MANAGER, ACCOUNTS,
PROJECT_MANAGER, VIEWER), `Permission`, `RolePermission`, `RefreshToken` (hashed, `family` uuid for
rotation-chain + reuse detection), `PasswordResetToken`, `EmailVerificationToken`, `AuditLog`,
`Attachment` (originalName/storedName/mimeType/sizeBytes/hash/storageBucket/storagePath/
entityType/entityId/variant["original"|"thumbnail"]/parentId self-relation/version/uploadedById —
generic so future Tender/BOQ documents reuse it unchanged).

Single role per user (`User.roleId` FK) — granular access control lives in `RolePermission`.
Refresh tokens store only a SHA-256 hash, never the raw value.

## Auth Flow

- **Access token**: JWT, 15 min TTL, payload `{sub, roleId, roleName}` only (permissions resolved
  server-side per request from a Redis-cached role→permissions set).
- **Refresh token**: opaque random value, 30-day TTL, httpOnly/`Secure`(prod)/`SameSite=Lax` cookie
  scoped to `Path=/api/v1/auth`. Access token returned in JSON body, kept in memory only on client.
- **Rotation with reuse detection**: each refresh revokes the used token and issues a new one in the
  same `family`; replaying an already-revoked token revokes the entire family (force logout) and
  logs `AUTH_TOKEN_REUSE_DETECTED`.
- Endpoints: register (admin-created, invite email), login, refresh, logout, logout-all,
  forgot-password, reset-password, verify-email, resend-verification, session list/revoke.

## RBAC

`requirePermission('resource:action')` middleware after `authenticate`, checks a Redis-cached
permission set per role (exact key → `resource:*` wildcard → `*:*` for Super Admin). Self-scoped
actions (own profile, own avatar, own sessions) bypass permission checks, use ownership checks in
the service layer. ~12 permission keys seeded across the 8 roles.

## File Uploads

Multer (memoryStorage, size/type limits) → magic-number MIME sniffing → Sharp pipeline for images
(strip EXIF, resize original + thumbnail, encode webp) → SHA-256 hash → MinIO/S3 via AWS SDK v3 →
`Attachment` row(s) → response with presigned GET URLs (15 min TTL, private bucket by default).
Phase 1's concrete consumer is user avatar upload; `AttachmentsService`/`/api/v1/attachments` are
generic and reused as-is by every future module (confirmed: Phase 2 tender documents reused this
unchanged, only adding `documentType`/`documentGroupId`/`isCurrent` columns additively).

## Error Handling & Logging

Custom `AppError` hierarchy → centralized `errorHandler.middleware.ts` maps Zod errors, Prisma
known-request errors (P2002→409, P2025→404), `AppError` subclasses → standard
`{success:false, error:{code,message,details?,requestId}}` envelope. Pino for structured stdout logs,
separate from the DB `AuditLog` (business/security events). `GET /api/v1/health` checks
Postgres/Redis/S3. Rate limiting (express-rate-limit + Redis) on login/refresh/forgot-password.

## Frontend (`apps/web/src`)

Next.js App Router: `(auth)` route group (login/forgot-password/reset-password/verify-email) and
`(dashboard)` route group (AppShell: sidebar + topbar + breadcrumbs, dark/light via next-themes).
TanStack Query + Axios instance with single-in-flight refresh-on-401 interceptor. Auth state
(in-memory access token + user) in Zustand, never persisted. Pages: dashboard home (real widgets
only), users list/detail/create/edit, own profile + avatar upload, settings → roles/audit/sessions.
`packages/ui`: Button, Form (RHF wrappers), DataTable (TanStack Table, manual pagination/sorting),
Dialog, AlertDialog, Toast, Avatar+upload, Badge, Card, Dropdown, Skeleton, Pagination.
`packages/types` holds hand-maintained DTOs shared by web+server.

## Testing, Docs, CI

Vitest + Supertest: unit tests (fake repositories) for `AuthService`/`UsersService`; integration
tests against a real test Postgres. Swagger/OpenAPI from JSDoc in each module's routes file, served
at `/api/v1/docs`. `packages/database/prisma/seed.ts` creates all 8 roles, full permission matrix,
a Super Admin + one sample user per role. GitHub Actions: install → lint → typecheck → build → test
with Postgres+Redis service containers.

## Verification (as executed)

- `docker compose up -d` (postgres/redis/minio/mailhog) clean; `pnpm db:migrate` + `pnpm db:seed` ran
  without error.
- `pnpm dev` started server (:4000) + web (:3000) via Turborepo.
- Full browser walkthrough (Playwright): unauthenticated redirect to `/login`, login as Super Admin,
  dashboard widgets render, users list/create, avatar upload (real presigned MinIO URL downloaded
  and confirmed valid webp), dark mode toggle, logout.
- `pnpm turbo run lint typecheck test build` passed across the monorepo.

## Critical Files

- `packages/database/prisma/schema.prisma`
- `apps/server/src/shared/middleware/authenticate.middleware.ts`
- `apps/server/src/shared/middleware/requirePermission.middleware.ts`
- `apps/server/src/modules/auth/token.service.ts`
- `apps/server/src/infra/storage/s3.service.ts`
- `packages/database/prisma/seed.ts`
- `apps/web/src/lib/axios.ts`

**Status: shipped and verified.** Phase 2 (Core Tender Management) built on top of this foundation
and is also complete — see `phase-2-tenders.md` (ported from the live session plan file) for details.
