# BMP — Phase 2 (Core Tender Management) Implementation Plan

## Context

Phase 1 (Foundation: monorepo, auth, RBAC, user management, generic file attachments, dashboard shell) is complete, built, and verified end-to-end (browser walkthrough + API tests, all passing). This plan covers **Phase 2: Core Tender Management** — the first real business module, per the master spec's phased roadmap: Tender CRUD, status workflow, document management with versioning, search/filters, audit logging, dashboard widgets, and notifications.

Everything here builds additively on Phase 1's infrastructure — the generic `Attachment`/`AttachmentsService` (file uploads), `AuditService` (event logging), `requirePermission` RBAC, the shared `DataTable`/`Form` UI components, and the `TokenService`/axios-refresh auth flow are all reused, not forked. A design pass (via a planning subagent, cross-checked against the actual Phase 1 code) produced the concrete decisions below.

## Scope decisions

- **Client/Organization**: Tenders need a real client FK, not free text. Build a minimal `Organization` + `OrganizationContact` model (government/private, address, GST, contacts) — enough for a client picker and basic contact info. Full CRM (communication history, linked Projects) is out of scope until the Project module (Phase 5) exists.
- **Search**: Solid filterable/paginated tender list (status, department, client, assignee, priority, date range, text search on title/tender number). Cross-entity global full-text search is explicitly Phase 7 — not built now.
- **Money fields**: `Float`, not `Decimal`. These are estimates/fees at this phase, not final ledger entries — Decimal's serialization overhead (Prisma `Decimal` → JSON) isn't worth it yet. Phase 6 (Finance) will design real accounting precision when it builds the ledger.
- **Status workflow**: strict, single-path transitions (no manual override/force flag in this phase).
- **Notifications**: in-app (polled, no websockets) + email for two triggers (assignment, status change) plus one scheduled trigger (submission-deadline reminders via a new BullMQ repeatable job). SMS/WhatsApp stay future work per the spec.

## Prisma schema additions (`packages/database/prisma/schema.prisma`)

New enums: `TenderStatus` (14 states: DRAFT → UPCOMING → DOCUMENT_COLLECTION → UNDER_STUDY → BOQ_PREPARATION → RATE_ANALYSIS → APPROVAL_PENDING → SUBMITTED → TECHNICALLY_QUALIFIED → FINANCIALLY_QUALIFIED → WON/LOST → CANCELLED → ARCHIVED), `TenderPriority` (LOW/MEDIUM/HIGH/URGENT), `TenderAssigneeRole` (OWNER/ESTIMATOR/REVIEWER/OTHER), `OrganizationType` (GOVERNMENT/PRIVATE). `type`/`category`/`department`/`state`/`location` stay plain strings (curated suggestion lists live in `packages/types`, not DB enums — avoids a migration every time a new tender type appears).

New models: `Tender` (client FK to `Organization`, all spec fields, `status`/`statusChangedAt`, denormalized `winnerName`/`winningBidAmount`/`lossReason`), `TenderAssignee` (join table, multiple staff per tender with a role), `TenderCompetitor` (competitive intel, decoupled from winner fields), `Organization` + `OrganizationContact`, `Tag` + `TenderTag` (generic `Tag` table with a per-consumer join table — the pattern future modules like Vendors/Projects will reuse), `Notification` (in-app, `userId`/`type`/`title`/`body`/`entityType`/`entityId`/`isRead`).

Additive changes to the existing `Attachment` model (no fork of `AttachmentsService`): add `documentType String?`, `documentGroupId String?` (self-relation, distinct from the existing `parentId` which stays reserved for image original→thumbnail variants), `isCurrent Boolean @default(true)`, plus indexes on `documentGroupId` and `[entityType, entityId, documentType]`. Version 1 of a document sets `documentGroupId` to its own id after creation, so "all versions" is always `WHERE documentGroupId = X` with no null special-case.

`User` gains back-relations for tender assignments/creation, organization creation, and notifications.

## Backend changes

**`AttachmentsService` (additive only)**: `upload()` gains optional `documentType?`/`replacesAttachmentId?` params — when replacing, resolves the version chain, increments `version`, flips prior rows' `isCurrent` to false. `listByEntity()` gains an optional `documentType` filter and defaults to current-version-only. New `listVersions(documentGroupId)`. The existing avatar upload path is untouched (never sets `documentType`, so `isCurrent` stays `true` for it — no behavior change).

**`AuditRepository`/`AuditService` (additive only)**: `AuditLogFilters` gains `entityId?`/`action?`. No new history table — tender status history is just a filtered read of the existing `AuditLog` via a new `GET /tenders/:id/status-history` route (permission `tenders:read`, not the admin-only `audit:read`).

**New modules** (`apps/server/src/modules/`), each following the exact `users`/`auth` module file pattern (`*.repository.ts` / `*.service.ts` / `*.controller.ts` / `*.routes.ts` / `*.validation.ts` / `*.mapper.ts` / `*.module.ts`):

- **`tenders/`** — CRUD, `PATCH /:id/status` (validates against a `TENDER_STATUS_TRANSITIONS` const map in `packages/types/src/tender.ts`, logs via `AuditService`, fires notifications), `/:id/status-history`, `/:id/assignees` (add/remove, fires `TENDER_ASSIGNED` notification+email), `/:id/competitors`, `/:id/documents` (delegates entirely to `AttachmentsService`), `/:id/documents/:documentGroupId/versions`, `/:id/tags`.
- **`organizations/`** — CRUD + contacts sub-resource; delete blocked if any `Tender.clientId` references it.
- **`tags/`** — small standalone CRUD (Tag is intentionally generic/shared, not tender-owned).
- **`notifications/`** — list/unread-count/mark-read/mark-all-read, auth-only (row-owned by `req.user.id`, same precedent as `/users/me`, no extra permission key).

**Scheduled reminders**: new `tenderReminderQueue` (BullMQ, mirrors the existing `emailQueue` pattern in `apps/server/src/infra/queue/queues.ts`), a new worker started from `apps/server/src/worker.ts` alongside the email worker, registering a repeatable job (`{ repeat: { pattern: "0 7 * * *" }, jobId: "tender-deadline-check" }` — idempotent to re-register on every boot). Job scans tenders due in {1,3,7} days (excluding terminal statuses), dedupes via an existing-notification check (no new "last reminded" column needed), and fans out in-app + email notifications.

**RBAC**: new permission keys `tenders:{create,read,update,delete,assign,change_status}`, `organizations:{create,read,update,delete}`, `tags:{create,read,update,delete}` added to `packages/types/src/rbac.ts`. Tender Manager gets full tender/org/tag management; Estimator gets read + `tenders:update` (for filling in details/docs, not assigning/status changes); Purchase Manager/Accounts/Project Manager get read-only; Viewer gets read-only. Admin/Super Admin unaffected (already blanket). `pnpm db:seed` idempotently upserts the new permissions — no destructive migration.

## Frontend changes

New pages under `apps/web/src/app/(dashboard)/`: `tenders/page.tsx` (DataTable + filter toolbar), `tenders/new/page.tsx` and `tenders/[id]/edit/page.tsx` (shared full-page form component — ~20 fields is too many for a modal), `tenders/[id]/page.tsx` (overview header with a status stepper + change-status dialog, then Tabs for Overview/Documents/Assignees/Competitors/Status History), `organizations/page.tsx` + `new`/`[id]`/`[id]/edit` (contacts managed inline via `Dialog`, only ~4 fields each), `notifications/page.tsx` (full history; the topbar bell shows latest 10).

Nav additions to `apps/web/src/components/layout/nav-items.ts`: Tenders (`tenders:read`), Organizations (`organizations:read`). New `apps/web/src/components/layout/notification-bell.tsx` mounted in `topbar.tsx` next to the existing `ThemeToggle`, polling via TanStack Query (`refetchInterval: 30_000`).

New reusable `packages/ui` components (all domain-agnostic, following the existing component style): `tabs.tsx` (Radix `@radix-ui/react-tabs`), `stepper.tsx` (generic `steps: {label, state}[]`), `multi-select.tsx` (checkbox-list popover for status filters/assignee/tag pickers — the existing `select.tsx` is single-select only), `document-upload.tsx` (versioned upload widget modeled on the existing `avatar-upload.tsx`, generic version-history list prop). Existing components reused as-is: `DataTable`, `Form`, `Select`, `Badge`, `Card`, `Dialog`/`AlertDialog`, `Avatar`, `DropdownMenu`, `Pagination`. Date fields use plain `<Input type="date">` — a real date-picker/calendar component is explicitly deferred until a later phase needs richer date UX.

Dashboard (`apps/web/src/app/(dashboard)/dashboard/page.tsx`) gains real widgets backed by the new data: upcoming submission deadlines (next 7 days), tender count by status (small Recharts bar chart — `recharts` is already a dependency, currently unused), pending-approval count.

## Testing

Vitest unit tests (fake repositories, matching the existing `auth.service.spec.ts`/`users.service.spec.ts` style): `tenders.service.spec.ts` (valid/invalid status transitions, delete-blocked-unless-draft, assignment triggers a notification), `organizations.service.spec.ts` (CRUD, delete blocked when referenced by a tender), `notifications.service.spec.ts` (create/list/mark-read ownership enforcement — a user can't mark another user's notification read). One integration test extending the existing `auth.integration.spec.ts` pattern: create a tender, change its status through two valid transitions, assert the audit/status-history endpoint reflects both entries.

## Build order

1. Prisma schema additions + migration + updated seed permission matrix
2. `AttachmentsService`/`AuditRepository` additive changes
3. `packages/types` additions: `tender.ts` (DTOs, status transition map, curated type/category lists), RBAC matrix update
4. Backend: `organizations` → `tags` → `notifications` → `tenders` modules (this order because tenders depends on the other three)
5. BullMQ tender-reminder queue/worker + email templates
6. Backend tests
7. `packages/ui` new components: tabs, stepper, multi-select, document-upload
8. Frontend: organizations pages → tenders pages → dashboard widgets → notification bell
9. Install deps, typecheck, lint, build, run tests

## Verification

- `pnpm db:migrate` applies cleanly; `pnpm db:seed` idempotently adds new permissions without disturbing existing users.
- `pnpm typecheck && pnpm lint && pnpm build` clean across all workspaces (same bar as Phase 1).
- `pnpm --filter @bmp/server test` — new unit + integration tests pass alongside the existing Phase 1 suite.
- Manual/browser walkthrough (dev servers + Docker already running): log in as Tender Manager → create an organization → create a tender against it → upload a document, re-upload it (confirm version 2 supersedes version 1 in the UI) → assign an Estimator (confirm they receive an in-app notification, and Mailhog receives the email) → advance status through 2–3 valid transitions (confirm illegal transitions are rejected) → confirm the dashboard widgets and status history reflect reality → log in as Viewer and confirm they can read but not mutate.

## Critical files

- `packages/database/prisma/schema.prisma`
- `packages/types/src/rbac.ts`, new `packages/types/src/tender.ts`
- `apps/server/src/modules/attachments/attachments.service.ts`
- `apps/server/src/modules/audit/audit.repository.ts`
- `apps/server/src/infra/queue/queues.ts`, `apps/server/src/worker.ts`
- `apps/server/src/routes/v1.router.ts`
- `apps/web/src/components/layout/topbar.tsx`, `apps/web/src/components/layout/nav-items.ts`

Phases 3–8 (BOQ/Estimation, Procurement, Project Execution, Finance, Reporting, Production hardening) remain out of scope and will each get their own plan once Phase 2 is verified working end-to-end.
