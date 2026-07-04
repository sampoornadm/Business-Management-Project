# BMP — Phase 5 (Project Execution) Implementation Plan

## Context

Phases 1–4 (Foundation, Tender Management, BOQ & Estimation, Procurement) are complete and verified.
Phase 5 covers the master spec's Project Execution module: converting a won tender into a project,
milestone tracking, material/labor consumption tracking, progress billing, project costing, and a
progress dashboard. Per `spec.md`: "Convert tender to project, milestones, material/labor tracking,
billing, project costing, progress dashboard."

## Scope decisions

- **A Project is created from a WON tender**, one-to-one (`Tender.project` optional back-relation,
  `Project.tenderId @unique`). Conversion snapshots `name`/`budget` (from the tender's
  `winningBidAmount` or estimated cost) at creation time — like every other cross-entity reference in
  this codebase (`TenderCompetitor`, `RfqItem.description`), a project doesn't live-join back to the
  tender for its core numbers, so later tender edits don't silently reshape an in-flight project.
- **Milestones are a flat, ordered list**, not nested — `ProjectMilestone` with `sortOrder`,
  `status` (PENDING/IN_PROGRESS/COMPLETED/DELAYED), `plannedDate`/`completedDate`, and a `weightPercent`
  used to compute overall progress (`Σ weightPercent for COMPLETED milestones`) — simple and
  explainable over a critical-path/Gantt engine, which is out of scope.
- **Material and labor tracking are simple dated log entries**, not inventory management (no stock
  levels, no warehouse module — that's beyond what the spec asks for here). `ProjectMaterialUsage`
  (optionally references a `boqItemId` for traceability, else free-text `materialName`) and
  `ProjectLaborEntry` (`category`/`workerCount`/`units`/`ratePerUnit`/`amount`, amount server-computed)
  are both append-only logs a Project Manager records as work happens.
- **Billing is progress ("RA") billing**, the standard construction pattern: each `ProjectBill` records
  a cumulative work-done value as of that bill; `currentBillAmount` is server-computed as
  `cumulativeAmount - previousCumulativeAmount` (previous bill's cumulative, 0 for the first bill) —
  never trust a client-submitted current amount, same "recompute, don't trust client math" rule as
  BOQ/PO amounts.
- **Costing and the progress dashboard are computed reads**, not stored tables — mirrors the
  BOQ-comparison and tender-dashboard-stats pattern already established. Costing aggregates: BOQ
  estimated total (from Phase 3), actual spend (Σ issued/received Purchase Orders linked to the same
  `tenderId`, Phase 4) + Σ labor entry amounts, vs. the project budget. Progress aggregates: milestone
  completion %, days elapsed/remaining vs. planned dates, latest bill's cumulative amount vs. budget.
- **One module, several sub-resources** (`projects/`), matching how `tenders/` already owns
  assignees/competitors/documents/tags as one module rather than five — milestones/material/labor/
  bills are all Project-scoped child lists, not independent entities with their own lifecycle.

## Prisma schema additions

```prisma
enum ProjectStatus { ACTIVE ON_HOLD COMPLETED CANCELLED }
enum MilestoneStatus { PENDING IN_PROGRESS COMPLETED DELAYED }
enum LaborCategory { SKILLED UNSKILLED SUPERVISORY }
enum BillStatus { DRAFT SUBMITTED APPROVED PAID }

model Project {
  id            String        @id @default(uuid())
  tenderId      String        @unique
  tender        Tender        @relation(fields: [tenderId], references: [id], onDelete: Restrict)
  name          String
  status        ProjectStatus @default(ACTIVE)
  budget        Float
  startDate     DateTime
  endDate       DateTime?     // planned completion
  actualEndDate DateTime?
  location      String?
  notes         String?

  createdById String
  createdBy   User   @relation("ProjectCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  milestones     ProjectMilestone[]
  materialUsages ProjectMaterialUsage[]
  laborEntries   ProjectLaborEntry[]
  bills          ProjectBill[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
}

model ProjectMilestone {
  id            String          @id @default(uuid())
  projectId     String
  project       Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  title         String
  plannedDate   DateTime?
  completedDate DateTime?
  status        MilestoneStatus @default(PENDING)
  weightPercent Float           @default(0)
  sortOrder     Int             @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([projectId])
}

model ProjectMaterialUsage {
  id           String   @id @default(uuid())
  projectId    String
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  boqItemId    String?
  materialName String
  unit         String?
  quantityUsed Float
  usageDate    DateTime @default(now())
  remarks      String?

  recordedById String
  recordedBy   User   @relation("ProjectMaterialRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([projectId])
}

model ProjectLaborEntry {
  id          String        @id @default(uuid())
  projectId   String
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  category    LaborCategory
  description String
  workerCount Int
  units       Float         // e.g. person-days
  ratePerUnit Float
  amount      Float         // server-computed: workerCount * units * ratePerUnit
  entryDate   DateTime      @default(now())
  remarks     String?

  recordedById String
  recordedBy   User   @relation("ProjectLaborRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([projectId])
}

model ProjectBill {
  id                String     @id @default(uuid())
  projectId         String
  project           Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  billNumber        String
  billDate          DateTime   @default(now())
  cumulativeAmount  Float      // total work done as of this bill, entered by the PM
  currentBillAmount Float      // server-computed: cumulativeAmount - previous bill's cumulativeAmount
  status            BillStatus @default(DRAFT)
  remarks           String?

  createdById String
  createdBy   User   @relation("ProjectBillCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([projectId, billNumber])
  @@index([projectId])
}
```

`Tender` gains `project Project?` (back-relation, no FK column — the FK lives on `Project`). `User`
gains `createdProjects Project[]`, `recordedMaterialUsages ProjectMaterialUsage[]`,
`recordedLaborEntries ProjectLaborEntry[]`, `createdProjectBills ProjectBill[]`.

## Backend module (`apps/server/src/modules/projects/`)

Single module, same file pattern as every prior module. Key service methods:
`createFromTender(tenderId, input, actorId)` (asserts `tender.status === "WON"` and no existing
project for that tender, snapshots budget from `winningBidAmount ?? estimatedCost`); milestone
CRUD + reorder; material-usage/labor-entry create+list (append-only, no update/delete — a correction
is a new entry, matching the audit-log-is-append-only philosophy already used for `AuditLog`);
bill create (computes `currentBillAmount` server-side from the previous bill in the same project) +
status transition (DRAFT→SUBMITTED→APPROVED→PAID, strict single-path like `TenderStatus`); `GET
/projects/:id/costing` (BOQ estimate vs. Σ PO amounts + Σ labor amounts vs. budget) and `GET
/projects/:id/progress` (milestone %, cumulative billed amount, days elapsed/remaining) — both
computed, no new tables.

Endpoints (permission column mirrors the existing pattern):

| Method & Path | Permission |
|---|---|
| POST /projects/from-tender | `projects:create` |
| GET /projects, GET/PATCH /projects/:id | `projects:read` / `projects:update` |
| POST/GET/PATCH/DELETE /projects/:id/milestones(/:milestoneId) | `projects:update` / `projects:read` |
| POST/GET /projects/:id/material-usage | `projects:update` / `projects:read` |
| POST/GET /projects/:id/labor-entries | `projects:update` / `projects:read` |
| POST/GET /projects/:id/bills | `projects:update` / `projects:read` |
| PATCH /projects/:id/bills/:billId/status | `projects:update` |
| GET /projects/:id/costing, GET /projects/:id/progress | `projects:read` |

RBAC additions: `projects:{create,read,update,delete}`. Project Manager gets full access (their core
job per the spec); Tender Manager/Estimator/Purchase Manager/Accounts get read-only (cross-functional
visibility); Viewer read-only.

## Frontend

- `apps/web/src/app/(dashboard)/projects/page.tsx` (list) — only WON tenders without an existing
  project show a "Convert to Project" action (surfaced on the tender detail page, not a separate
  picker flow).
- `apps/web/src/app/(dashboard)/projects/[id]/page.tsx` — header (status, budget, dates), and Tabs for
  Overview (progress %, costing summary cards), Milestones (list with inline status update),
  Material/Labor (two append-only log tables with an "Add entry" dialog each), Bills (list + "Create
  bill" dialog showing computed current-bill-amount preview, status stepper).
- Tender detail page (`tenders/[id]/page.tsx`) gains a "Convert to Project" button, visible only when
  `tender.status === "WON"` and no project exists yet.
- Nav addition: Projects (`projects:read`).

## Testing

Unit tests (fake repos): conversion rejects a non-WON tender and rejects converting the same tender
twice; milestone progress % calculation; labor entry amount computed server-side
(`workerCount * units * ratePerUnit`); bill `currentBillAmount` computed from the previous bill
(and equals `cumulativeAmount` for the first bill); bill status transitions reject skipping a step.
Integration test: convert a WON tender to a project, add a milestone and mark it complete, record a
material usage and a labor entry, create two bills and confirm the second bill's `currentBillAmount`
is the delta, fetch `/costing` and `/progress` and confirm the numbers match.

## Build order

1. Prisma schema additions + migration + RBAC matrix update
2. `projects/` module: conversion → milestones → material/labor logs → bills → costing/progress reads
3. Backend tests
4. Frontend: projects list/detail page with tabs, "Convert to Project" button on tender detail
5. Typecheck, lint, build, test across the full monorepo
6. Browser walkthrough: convert the Phase 3/4 tender (once WON) to a project, add milestones, log
   material/labor, create two bills, confirm costing/progress numbers

## Critical files (once built)

- `packages/database/prisma/schema.prisma`
- `apps/server/src/modules/projects/projects.service.ts` (conversion, bill computation, costing/
  progress aggregation)
- `packages/types/src/project.ts`, `packages/types/src/rbac.ts`

Phases 6–8 (Finance, Reporting, Production hardening) remain out of scope and will each get their own
plan once Phase 5 is verified working end-to-end.

## Status: shipped and verified

Built as planned, no scope deviations. Verified: `pnpm turbo run lint typecheck build` clean across
all 6 workspaces (web build/typecheck run sequentially, not concurrently, per the established
`.next` race gotcha); 104/104 backend tests passing (12 new project unit tests covering WON-only/
one-project-per-tender conversion guards, milestone progress-percent math, labor-entry amount
computation, bill delta computation and status-transition guards, costing aggregation; 6 new
integration tests driving a tender through the full status chain to WON, converting it, and
exercising milestones/labor/bills/costing/progress against a real Postgres). Browser walkthrough
(Tender Manager creates+advances a tender to WON via API setup calls, Project Manager drives the rest
via the UI): converted the WON tender to a project, added and completed a milestone, recorded a labor
entry, created a progress bill — confirmed the overview cards' progress %, actual-cost, and
budget-variance numbers all computed correctly, with screenshots at every step and no console errors
beyond the expected pre-login 401 probe.
