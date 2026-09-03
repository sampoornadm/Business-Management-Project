# Budgetary Quotations + Quotation Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BUDGETARY` tender kind (own auto-generated number, reuses the whole tender/BOQ
pipeline, links back to the real tender it converts into) plus a new "Quotation" document
(Word/CSV/PDF export of a tender's current BOQ, saved to the tender's folder like other generated
docs) and consolidated download menus on the tender detail, tender list, and RFQ pages.

**Architecture:** `Tender` gets a `kind` enum column and a self-referential `convertedFromId`; every
existing tender/BOQ/RFQ/PO/Bill code path is unchanged and shared by both kinds. A new
`quotation-document.ts` module (alongside the existing `document-generation.service.ts`) builds a
flat row list from the current BOQ's tree and renders it to docx/csv/pdf, reusing the already-generic
`saveGeneratedTenderDocument()` helper to persist a copy into the tender's folder — exactly the
mechanism `generateUndertaking` already uses. Frontend work is a new `TenderDownloadMenu` /
`RfqDownloadMenu` dropdown (using `packages/ui`'s existing `DropdownMenu` + submenu, no new
dependency) replacing scattered download buttons in three places, plus a kind toggle on tender
creation and a same-client linking picker on the tender detail page.

**Tech Stack:** Express + Prisma + PostgreSQL (backend), Next.js + React Hook Form + TanStack Query
(frontend), `pdfkit` (PDF), `docxtemplater` (Word), Vitest (unit + integration tests).

**Spec:** `docs/superpowers/specs/2026-09-03-budgetary-quotations-design.md`

## Global Constraints

- Follow the module conventions in the root `CLAUDE.md` exactly: `*.repository.ts` /
  `*.service.ts` / `*.controller.ts` / `*.routes.ts` / `*.validation.ts` / `*.mapper.ts` /
  `*.module.ts` per backend module; modules import sibling singletons from `*.module.ts` rather
  than re-instantiating repositories.
- RBAC: no new permission keys. Reuse `tenders:create`, `tenders:read`, `tenders:update`,
  `tenders:generate_document` throughout — all already exist and are seeded.
- Never run `prisma migrate dev` (without `--create-only`) against this schema — the pgvector HNSW
  indexes are permanently-undeclared drift and it will hit an interactive "corrective migration"
  prompt that can silently drop those indexes. Use `--create-only` to generate the migration file,
  review the SQL, then apply with `migrate:deploy` (no drift-diff prompt). See Task 1.
- After any Prisma schema change, run `pnpm db:generate` — the generated client
  (`packages/database/generated/client`) does not regenerate itself.
- Tests: Vitest, hand-written fake repositories for unit tests (no mocking framework), real
  Postgres via `.env.test` for `*.integration.spec.ts` (requires `docker compose up -d postgres
  redis minio minio-init mailhog` + migrations applied to `bmp_test` first).
- Money/numeric fields stay `Float`/plain JS numbers — matches the rest of the BOQ/tender schema,
  not `Decimal`.

---

## Task 1: Database schema — `TenderKind` + linking

**Files:**
- Modify: `packages/database/prisma/schema.prisma:471-554` (add `TenderKind` enum, `Tender.kind`,
  `Tender.convertedFromId`/`convertedFrom`/`convertedTo`)
- Create: `packages/database/prisma/migrations/<timestamp>_add_tender_kind_and_conversion/migration.sql`
  (generated, then reviewed)

**Interfaces:**
- Produces: Prisma model `Tender.kind: TenderKind` (`"TENDER" | "BUDGETARY"`, default `"TENDER"`),
  `Tender.convertedFromId: string | null`, relation `Tender.convertedFrom: Tender | null`,
  `Tender.convertedTo: Tender[]`. Consumed by every later task.

- [ ] **Step 1: Add the enum and fields to the schema**

In `packages/database/prisma/schema.prisma`, right before `enum TenderPriority` (currently line
479), add:

```prisma
enum TenderKind {
  TENDER
  BUDGETARY
}
```

Then in the `Tender` model (currently lines 493-554), add `kind` right after `status`/
`statusChangedAt`/`priority` and the self-relation right after `lossReason`:

```prisma
model Tender {
  id                  String         @id @default(uuid())
  businessId          String
  business            Business       @relation(fields: [businessId], references: [id], onDelete: Restrict)
  tenderNumber        String         @unique
  title               String
  clientId            String
  client              Organization   @relation(fields: [clientId], references: [id], onDelete: Restrict)
  department          String?
  type                String?
  category            String?
  location            String?
  state               String?
  estimatedCost       Float?
  emdAmount           Float?
  tenderFee           Float?
  documentFee         Float?
  submissionDate      DateTime?
  openingDate         DateTime?
  validityPeriodDays  Int?
  status              TenderStatus   @default(DRAFT)
  statusChangedAt     DateTime       @default(now())
  priority            TenderPriority @default(MEDIUM)
  // TENDER is a real tender (tenderNumber is hand-typed, copied off the government notice).
  // BUDGETARY is a rough, no-timeline price quote sent to a client before a real tender exists —
  // it runs through the exact same BOQ/estimation pipeline, just tagged differently, and gets a
  // server-generated tenderNumber instead (see TendersRepository.create).
  kind                TenderKind     @default(TENDER)
  description         String?
  remarks             String?
  notes               String?
  dealingOfficerName  String?
  dealingOfficerEmail String?
  dealingOfficerPhone String?
  winnerName          String?
  winningBidAmount    Float?
  lossReason          String?
  // Set on a TENDER-kind row once the estimator tags it back to the BUDGETARY-kind row it grew
  // from. One tender links to at most one budgetary quotation; a budgetary quotation can still be
  // revised any number of times via ordinary BOQ versioning, linked or not.
  convertedFromId String?
  convertedFrom   Tender?  @relation("BudgetaryConversion", fields: [convertedFromId], references: [id], onDelete: SetNull)
  convertedTo     Tender[] @relation("BudgetaryConversion")

  createdById String
  createdBy   User   @relation("TenderCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  assignees      TenderAssignee[]
  competitors    TenderCompetitor[]
  tags           TenderTag[]
  boqs           Boq[]
  rfqs           Rfq[]
  purchaseOrders PurchaseOrder[]
  bills          Bill[]
  project        Project?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([businessId])
  @@index([clientId])
  @@index([status])
  @@index([submissionDate])
  @@index([kind])
  @@index([convertedFromId])
  @@map("tenders")
}
```

- [ ] **Step 2: Generate the migration without applying it (avoids the drift-diff prompt)**

Run from the repo root:

```bash
dotenv -e .env -- pnpm --filter @bmp/database exec -- prisma migrate dev --create-only --name add_tender_kind_and_conversion
```

Expected: a new directory
`packages/database/prisma/migrations/<timestamp>_add_tender_kind_and_conversion/` containing
`migration.sql`. No interactive prompt (that only fires on a plain `migrate dev`, not
`--create-only`).

- [ ] **Step 3: Review the generated SQL**

Open the generated `migration.sql` and confirm it contains (naming may vary slightly by Prisma
version, but the shape must match):

```sql
CREATE TYPE "TenderKind" AS ENUM ('TENDER', 'BUDGETARY');
ALTER TABLE "tenders" ADD COLUMN "kind" "TenderKind" NOT NULL DEFAULT 'TENDER';
ALTER TABLE "tenders" ADD COLUMN "convertedFromId" TEXT;
CREATE INDEX "tenders_kind_idx" ON "tenders"("kind");
CREATE INDEX "tenders_convertedFromId_idx" ON "tenders"("convertedFromId");
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

If it contains anything about `embeddingVector`/HNSW indexes, stop and do not apply it — that
means drift detection picked up the pgvector indexes; re-run Step 2 and if it recurs, hand-write
the migration SQL above directly into a new migration folder instead.

- [ ] **Step 4: Apply the migration**

```bash
dotenv -e .env -- pnpm --filter @bmp/database migrate:deploy
```

Expected: `1 migration found... Applied` with no prompts (deploy never does drift-diffing).

- [ ] **Step 5: Regenerate the Prisma client**

```bash
pnpm db:generate
```

Expected: completes without error. `packages/database/generated/client` now exports `TenderKind`.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(database): add TenderKind + Tender.convertedFromId for budgetary quotations"
```

---

## Task 2: Shared types (`@bmp/types`)

**Files:**
- Modify: `packages/types/src/tender.ts`
- Modify: `apps/web/src/components/tenders/tender-documents-tab.tsx:17-28` (exhaustive
  `Record<TenderDocumentType, string>` — will fail to typecheck once `QUOTATION` is added to the
  union unless updated here too)
- Modify: `apps/server/src/config/constants.ts:14-28` (`GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES`
  needs `text/csv` — `saveGeneratedTenderDocument` rejects an unlisted mime type)

**Interfaces:**
- Consumes: nothing new (this is the leaf shared-types package).
- Produces: `TENDER_KINDS`, `TenderKind`, `TENDER_KIND_LABELS` (Task 3, 7, 9 consume these).
  `TENDER_DOCUMENT_TYPES` gains `"QUOTATION"` (Task 5, 6 consume this).
  `TenderListItemDto.kind`, `TenderDto.convertedFrom: TenderLinkedBudgetaryDto | null` (Task 3
  mapper, Task 8/9/10 frontend consume these). `CreateTenderInput.kind?`,
  `UpdateTenderInput` gains `convertedFromId?: string | null` (Task 3 validation, Task 7/10
  frontend consume these). `ListTendersQuery.kind?` (Task 3 repository, Task 9 frontend consume
  this).

- [ ] **Step 1: Add `TenderKind`**

In `packages/types/src/tender.ts`, right after the existing `TENDER_STATUSES`/`TenderStatus`
block (after line 25, before `TENDER_PRIORITIES` at line 27), add:

```ts
export const TENDER_KINDS = ["TENDER", "BUDGETARY"] as const;
export type TenderKind = (typeof TENDER_KINDS)[number];

export const TENDER_KIND_LABELS: Record<TenderKind, string> = {
  TENDER: "Tender",
  BUDGETARY: "Budgetary Quotation",
};
```

- [ ] **Step 2: Add the `QUOTATION` document type**

In the same file, in `TENDER_DOCUMENT_TYPES` (currently lines 48-59), add `"QUOTATION"` right
after `"UNDERTAKING"`:

```ts
export const TENDER_DOCUMENT_TYPES = [
  "NIT",
  "BOQ",
  "TECHNICAL_SPECS",
  "DRAWINGS",
  "CORRIGENDUM",
  "TENDER_NOTICE",
  "ADDENDUM",
  "BILL",
  "UNDERTAKING",
  "QUOTATION",
  "GENERAL",
] as const;
```

And in `TENDER_DOCUMENT_TYPE_FOLDER_NAMES` (currently lines 68-79), add the matching folder name:

```ts
export const TENDER_DOCUMENT_TYPE_FOLDER_NAMES: Record<TenderDocumentType, string> = {
  NIT: "NIT",
  BOQ: "BOQ",
  TECHNICAL_SPECS: "Technical Specs",
  DRAWINGS: "Drawings",
  CORRIGENDUM: "Corrigendum",
  TENDER_NOTICE: "Tender Notice",
  ADDENDUM: "Addendum",
  BILL: "Bills",
  UNDERTAKING: "Undertakings",
  QUOTATION: "Quotations",
  GENERAL: "General",
};
```

- [ ] **Step 3: Add `kind` to `TenderListItemDto` and the linked-budgetary DTO to `TenderDto`**

In `TenderListItemDto` (currently lines 113-127), add `kind` after `priority`:

```ts
export interface TenderListItemDto {
  id: string;
  tenderNumber: string;
  title: string;
  department: string | null;
  client: TenderOrganizationSummaryDto;
  type: string | null;
  category: string | null;
  status: TenderStatus;
  priority: TenderPriority;
  kind: TenderKind;
  estimatedCost: number | null;
  submissionDate: string | null;
  assigneeCount: number;
  createdAt: string;
}
```

Add a new interface right before `TenderDto` (currently line 129):

```ts
export interface TenderLinkedBudgetaryDto {
  id: string;
  tenderNumber: string;
  title: string;
  updatedAt: string;
}
```

And add `convertedFrom` to `TenderDto` (currently lines 129-152), after `lossReason`:

```ts
export interface TenderDto extends TenderListItemDto {
  location: string | null;
  state: string | null;
  emdAmount: number | null;
  tenderFee: number | null;
  documentFee: number | null;
  openingDate: string | null;
  validityPeriodDays: number | null;
  statusChangedAt: string;
  description: string | null;
  remarks: string | null;
  notes: string | null;
  dealingOfficerName: string | null;
  dealingOfficerEmail: string | null;
  dealingOfficerPhone: string | null;
  winnerName: string | null;
  winningBidAmount: number | null;
  lossReason: string | null;
  convertedFrom: TenderLinkedBudgetaryDto | null;
  createdBy: { id: string; firstName: string; lastName: string };
  assignees: TenderAssigneeDto[];
  competitors: TenderCompetitorDto[];
  tags: TenderTagDto[];
  updatedAt: string;
}
```

- [ ] **Step 4: Add `kind`/`convertedFromId` to the input types and `kind` to the list query**

In `CreateTenderInput` (currently lines 154-177), add after `priority`:

```ts
export interface CreateTenderInput {
  tenderNumber: string;
  title: string;
  clientId: string;
  department?: string;
  type?: string;
  category?: string;
  location?: string;
  state?: string;
  estimatedCost?: number;
  emdAmount?: number;
  tenderFee?: number;
  documentFee?: number;
  submissionDate?: string;
  openingDate?: string;
  validityPeriodDays?: number;
  priority?: TenderPriority;
  kind?: TenderKind;
  description?: string;
  remarks?: string;
  notes?: string;
  dealingOfficerName?: string;
  dealingOfficerEmail?: string;
  dealingOfficerPhone?: string;
}

export type UpdateTenderInput = Partial<CreateTenderInput> & { convertedFromId?: string | null };
```

(This replaces the current `export type UpdateTenderInput = Partial<CreateTenderInput>;` on line
179.)

In `ListTendersQuery` (currently lines 241-252), add `kind` after `status`:

```ts
export interface ListTendersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TenderStatus;
  kind?: TenderKind;
  clientId?: string;
  department?: string;
  priority?: TenderPriority;
  assigneeUserId?: string;
  submissionDateFrom?: string;
  submissionDateTo?: string;
}
```

- [ ] **Step 5: Fix the other exhaustive `Record<TenderDocumentType, ...>`**

In `apps/web/src/components/tenders/tender-documents-tab.tsx`, add `QUOTATION: "Quotations"` to
`DOCUMENT_TYPE_LABELS` (currently lines 17-28), right after `UNDERTAKING`:

```ts
const DOCUMENT_TYPE_LABELS: Record<TenderDocumentType, string> = {
  NIT: "Notice Inviting Tender (NIT)",
  BOQ: "Bill of Quantities (BOQ)",
  TECHNICAL_SPECS: "Technical Specifications",
  DRAWINGS: "Drawings",
  CORRIGENDUM: "Corrigendum",
  TENDER_NOTICE: "Tender Notice",
  ADDENDUM: "Addendum",
  BILL: "Bills",
  UNDERTAKING: "Undertakings",
  QUOTATION: "Quotations",
  GENERAL: "General Documents",
};
```

- [ ] **Step 6: Allow CSV uploads through the generic attachment path**

In `apps/server/src/config/constants.ts`, add `"text/csv"` to `GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES`
(currently lines 14-28), after `"text/plain"`:

```ts
export const GENERIC_UPLOAD_LIMITS = {
  MAX_SIZE_BYTES: 25 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
    "text/plain",
    "text/csv",
  ] as const,
};
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @bmp/types typecheck && pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/server typecheck
```

Expected: no errors. (This is the step that proves the two `Record<TenderDocumentType, ...>` maps
are exhaustive again.)

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/tender.ts apps/web/src/components/tenders/tender-documents-tab.tsx apps/server/src/config/constants.ts
git commit -m "feat(types): add TenderKind, QUOTATION document type, and related DTOs"
```

---

## Task 3: Tenders backend — kind, budgetary numbering, linking

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`
- Modify: `apps/server/src/modules/tenders/tenders.validation.ts`
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`
- Modify: `apps/server/src/modules/tenders/tenders.mapper.ts`
- Test: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`

**Interfaces:**
- Consumes: `TenderKind`, `TENDER_KINDS` (Task 2).
- Produces: `TendersService.create()` accepts `kind?: TenderKind` (server-generates
  `tenderNumber` for `BUDGETARY`, matching `PO-...`/`BILL-...`'s
  `` `PREFIX-${randomUUID().split("-")[0].toUpperCase()}` `` pattern — no retry, same as those).
  `TendersService.update()` accepts `convertedFromId?: string | null` and validates it (target
  must be `TENDER` kind, referenced tender must be `BUDGETARY` kind, same `clientId`). Consumed by
  Task 4 (integration test), Task 7 (create form), Task 10 (linking UI).

- [ ] **Step 1: Repository — types, budgetary numbering, kind filter, `convertedFrom` include**

In `apps/server/src/modules/tenders/tenders.repository.ts`:

Add `TenderKind` to the `@bmp/database` type import (line 3-9):

```ts
import type {
  Prisma,
  PrismaClient,
  TenderAssigneeRole,
  TenderKind,
  TenderPriority,
  TenderStatus,
} from "@bmp/database";
```

Add `convertedFrom` to `tenderDetailArgs` (currently lines 26-37):

```ts
const tenderDetailArgs = {
  include: {
    client: { select: { id: true, name: true, type: true } },
    createdBy: { select: actorSummarySelect },
    assignees: {
      include: { user: { select: userSummarySelect }, assignedBy: { select: actorSummarySelect } },
      orderBy: { createdAt: "asc" },
    },
    competitors: { orderBy: { createdAt: "asc" } },
    tags: { include: { tag: true } },
    convertedFrom: { select: { id: true, tenderNumber: true, title: true, updatedAt: true } },
  },
} satisfies Prisma.TenderDefaultArgs;
```

In `CreateTenderData` (currently lines 51-76), make `tenderNumber` optional (the repository
generates it for `BUDGETARY`) and add `kind`/`convertedFromId`:

```ts
export interface CreateTenderData {
  tenderNumber?: string;
  title: string;
  department?: string | null;
  clientId: string;
  type?: string | null;
  category?: string | null;
  location?: string | null;
  state?: string | null;
  estimatedCost?: number | null;
  emdAmount?: number | null;
  tenderFee?: number | null;
  documentFee?: number | null;
  submissionDate?: Date | null;
  openingDate?: Date | null;
  validityPeriodDays?: number | null;
  priority?: TenderPriority;
  kind?: TenderKind;
  convertedFromId?: string | null;
  description?: string | null;
  remarks?: string | null;
  notes?: string | null;
  dealingOfficerName?: string | null;
  dealingOfficerEmail?: string | null;
  dealingOfficerPhone?: string | null;
  businessId: string;
  createdById: string;
}

export type UpdateTenderData = Partial<Omit<CreateTenderData, "createdById" | "kind">>;
```

Add `kind` to `TenderFilters` (currently lines 80-90):

```ts
export interface TenderFilters {
  businessId: string;
  search?: string;
  status?: TenderStatus;
  kind?: TenderKind;
  clientId?: string;
  department?: string;
  priority?: TenderPriority;
  assigneeUserId?: string;
  submissionDateFrom?: Date;
  submissionDateTo?: Date;
}
```

Replace the `create()` method (currently lines 203-205) to generate the budgetary number:

```ts
create(data: CreateTenderData): Promise<TenderDetail> {
  // BUDGETARY quotations have no external number to copy (unlike a real tender's government-
  // issued number) — generated the same one-shot way PO/Bill numbers already are
  // (purchase-orders.repository.ts / bills.repository.ts): no retry on collision, a random
  // 8-hex-char collision is astronomically unlikely.
  const tenderNumber =
    data.kind === "BUDGETARY"
      ? `BQ-${randomUUID().split("-")[0]!.toUpperCase()}`
      : data.tenderNumber!;
  return this.prisma.tender.create({
    data: { id: randomUUID(), ...data, tenderNumber },
    ...tenderDetailArgs,
  });
},
```

Add `kind: filters.kind` to the `findMany()` where clause (currently lines 165-188), right after
`status`:

```ts
const where: Prisma.TenderWhereInput = {
  businessId: filters.businessId,
  status: filters.status,
  kind: filters.kind,
  clientId: filters.clientId,
  priority: filters.priority,
  ...(filters.department ? { department: { contains: filters.department, mode: "insensitive" } } : {}),
  ...(filters.assigneeUserId ? { assignees: { some: { userId: filters.assigneeUserId } } } : {}),
  ...(filters.submissionDateFrom || filters.submissionDateTo
    ? {
        submissionDate: {
          gte: filters.submissionDateFrom,
          lte: filters.submissionDateTo,
        },
      }
    : {}),
  ...(filters.search
    ? {
        OR: [
          { title: { contains: filters.search, mode: "insensitive" } },
          { tenderNumber: { contains: filters.search, mode: "insensitive" } },
        ],
      }
    : {}),
};
```

- [ ] **Step 2: Validation — conditional `tenderNumber`, `convertedFromId` on update only**

In `apps/server/src/modules/tenders/tenders.validation.ts`, add `TENDER_KINDS` to the `@bmp/types`
import (line 1):

```ts
import { TENDER_ASSIGNEE_ROLES, TENDER_KINDS, TENDER_PRIORITIES, TENDER_STATUSES } from "@bmp/types";
```

Replace the `createTenderSchema`/`updateTenderSchema` pair (currently lines 27-56) with:

```ts
const createTenderBaseSchema = z.object({
  kind: z.enum(TENDER_KINDS).optional(),
  tenderNumber: z.string().max(100).optional(),
  title: z.string().min(1).max(300),
  clientId: z.string().uuid(),
  department: optionalText(150),
  type: optionalText(50),
  category: optionalText(50),
  location: optionalText(200),
  state: optionalText(100),
  estimatedCost: optionalNumber,
  emdAmount: priceField,
  tenderFee: priceField,
  documentFee: priceField,
  submissionDate: optionalDate,
  openingDate: z.coerce.date().optional(),
  validityPeriodDays: z.coerce.number().int().positive().optional(),
  priority: z.enum(TENDER_PRIORITIES).optional(),
  description: z.string().max(5000).optional(),
  remarks: z.string().max(5000).optional(),
  notes: z.string().max(20000).optional(),
  dealingOfficerName: z.string().max(200).optional(),
  dealingOfficerEmail: z.string().email().max(200).optional(),
  dealingOfficerPhone: z.string().max(30).optional(),
});

// tenderNumber is required for a real tender (hand-typed, off the government notice) but not for
// a budgetary quotation (server-generates one — see TendersRepository.create).
export const createTenderSchema = createTenderBaseSchema.superRefine((data, ctx) => {
  if ((data.kind ?? "TENDER") === "TENDER" && !data.tenderNumber?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["tenderNumber"],
      message: "Tender number is required",
    });
  }
});
export type CreateTenderBody = z.infer<typeof createTenderSchema>;

// kind is set at creation and immutable thereafter (changing it in place would leave the
// tenderNumber/folder from the old kind stale) — omitted here rather than accepted and ignored.
export const updateTenderSchema = createTenderBaseSchema
  .omit({ kind: true })
  .partial()
  .extend({ convertedFromId: z.string().uuid().nullable().optional() });
export type UpdateTenderBody = z.infer<typeof updateTenderSchema>;
```

Add `kind` to `listTendersQuerySchema` (currently lines 89-101), after `status`:

```ts
export const listTendersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  status: z.enum(TENDER_STATUSES).optional(),
  kind: z.enum(TENDER_KINDS).optional(),
  clientId: z.string().uuid().optional(),
  department: z.string().optional(),
  priority: z.enum(TENDER_PRIORITIES).optional(),
  assigneeUserId: z.string().uuid().optional(),
  submissionDateFrom: z.coerce.date().optional(),
  submissionDateTo: z.coerce.date().optional(),
});
export type ListTendersQueryParsed = z.infer<typeof listTendersQuerySchema>;
```

- [ ] **Step 3: Service — branch `create()`, validate `convertedFromId` in `update()`**

In `apps/server/src/modules/tenders/tenders.service.ts`, replace the duplicate-number check at the
top of `create()` (currently lines 80-84):

```ts
async create(
  data: Omit<CreateTenderData, "businessId">,
  context: ScopedRequestContext,
): Promise<TenderDto> {
  const kind = data.kind ?? "TENDER";
  if (kind === "TENDER") {
    const duplicate = await this.tendersRepository.findByTenderNumber(
      data.tenderNumber!,
      context.businessId,
    );
    if (duplicate) throw new ConflictError("A tender with this tender number already exists");
  }

  const client = await this.organizationsRepository.findById(data.clientId);
  if (!client) throw new BadRequestError("Invalid client");

  const tender = await this.tendersRepository.create({ ...data, kind, businessId: context.businessId });

  // ...rest of the method (folder creation, audit log, return) is unchanged
```

Replace `update()` (currently lines 116-139) to capture the existing tender and validate
`convertedFromId` when present:

```ts
async update(
  id: string,
  data: UpdateTenderData,
  actorId: string,
  context: ScopedRequestContext,
): Promise<TenderDto> {
  const existing = await this.assertTenderExists(id, context.businessId);

  if (data.clientId) {
    const client = await this.organizationsRepository.findById(data.clientId);
    if (!client) throw new BadRequestError("Invalid client");
  }

  if (data.convertedFromId !== undefined && data.convertedFromId !== null) {
    if (existing.kind !== "TENDER") {
      throw new BadRequestError("Only a real tender can link to a budgetary quotation");
    }
    const budgetary = await this.tendersRepository.findById(data.convertedFromId, context.businessId);
    if (!budgetary) throw new BadRequestError("Invalid budgetary quotation");
    if (budgetary.kind !== "BUDGETARY") {
      throw new BadRequestError("The linked tender must be a budgetary quotation");
    }
    if (budgetary.client.id !== existing.client.id) {
      throw new BadRequestError("The budgetary quotation must belong to the same client");
    }
  }

  const tender = await this.tendersRepository.update(id, data);
  await this.auditService.log({
    actorId,
    action: "TENDER_UPDATED",
    entityType: "Tender",
    entityId: id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  return toTenderDto(tender);
}
```

- [ ] **Step 4: Mapper — surface `kind` and `convertedFrom`**

In `apps/server/src/modules/tenders/tenders.mapper.ts`, add `kind` to `toTenderListItemDto()`
(currently lines 15-31), after `priority`:

```ts
export function toTenderListItemDto(entity: TenderListItem): TenderListItemDto {
  return {
    id: entity.id,
    tenderNumber: entity.tenderNumber,
    title: entity.title,
    department: entity.department,
    client: { id: entity.client.id, name: entity.client.name, type: entity.client.type },
    type: entity.type,
    category: entity.category,
    status: entity.status,
    priority: entity.priority,
    kind: entity.kind,
    estimatedCost: entity.estimatedCost,
    submissionDate: entity.submissionDate ? entity.submissionDate.toISOString() : null,
    assigneeCount: entity._count.assignees,
    createdAt: entity.createdAt.toISOString(),
  };
}
```

Add `convertedFrom` to `toTenderDto()` (currently lines 67-109), after `lossReason`:

```ts
export function toTenderDto(entity: TenderDetail): TenderDto {
  return {
    id: entity.id,
    tenderNumber: entity.tenderNumber,
    title: entity.title,
    department: entity.department,
    client: { id: entity.client.id, name: entity.client.name, type: entity.client.type },
    type: entity.type,
    category: entity.category,
    location: entity.location,
    state: entity.state,
    status: entity.status,
    priority: entity.priority,
    kind: entity.kind,
    estimatedCost: entity.estimatedCost,
    emdAmount: entity.emdAmount,
    tenderFee: entity.tenderFee,
    documentFee: entity.documentFee,
    submissionDate: entity.submissionDate ? entity.submissionDate.toISOString() : null,
    openingDate: entity.openingDate ? entity.openingDate.toISOString() : null,
    validityPeriodDays: entity.validityPeriodDays,
    statusChangedAt: entity.statusChangedAt.toISOString(),
    description: entity.description,
    remarks: entity.remarks,
    notes: entity.notes,
    dealingOfficerName: entity.dealingOfficerName,
    dealingOfficerEmail: entity.dealingOfficerEmail,
    dealingOfficerPhone: entity.dealingOfficerPhone,
    winnerName: entity.winnerName,
    winningBidAmount: entity.winningBidAmount,
    lossReason: entity.lossReason,
    convertedFrom: entity.convertedFrom
      ? {
          id: entity.convertedFrom.id,
          tenderNumber: entity.convertedFrom.tenderNumber,
          title: entity.convertedFrom.title,
          updatedAt: entity.convertedFrom.updatedAt.toISOString(),
        }
      : null,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    assignees: entity.assignees.map(toAssigneeDto),
    assigneeCount: entity.assignees.length,
    competitors: entity.competitors.map(toCompetitorDto),
    tags: entity.tags.map(toTagDto),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 5: Write the failing unit tests**

In `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`, update `buildTender()`
(currently lines 27-63) to include the two new fields in its defaults:

```ts
function buildTender(overrides: Partial<TenderDetail> = {}): TenderDetail {
  const now = new Date();
  return {
    id: randomUUID(),
    tenderNumber: "TND-0001",
    title: "Road Construction",
    department: "PWD",
    clientId: CLIENT_ID,
    client: { id: CLIENT_ID, name: "Public Works Department", type: "GOVERNMENT" },
    type: "OPEN",
    category: "ROAD",
    location: "City Center",
    state: "Maharashtra",
    estimatedCost: 1_000_000,
    emdAmount: null,
    tenderFee: null,
    documentFee: null,
    submissionDate: now,
    openingDate: null,
    validityPeriodDays: null,
    status: "DRAFT",
    statusChangedAt: now,
    priority: "MEDIUM",
    kind: "TENDER",
    convertedFromId: null,
    convertedFrom: null,
    description: null,
    remarks: null,
    winnerName: null,
    winningBidAmount: null,
    lossReason: null,
    createdById: randomUUID(),
    createdBy: { id: randomUUID(), firstName: "Tanya", lastName: "Manager" },
    assignees: [],
    competitors: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TenderDetail;
}
```

`FakeTendersRepository.create()` (currently lines 82-91) already spreads `...data` into
`buildTender()`, so it picks up `kind`/`convertedFromId` from whatever `create()` is called with —
no change needed there. Add a new `describe` block right after the existing status-transition
tests (after line 328, before the closing `});` of `describe("TendersService", ...)`):

```ts
describe("budgetary quotations", () => {
  it("creates a budgetary quotation without requiring a tenderNumber, and doesn't dup-check it", async () => {
    const dto = await service.create(
      { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY" },
      ctx,
    );
    expect(dto.kind).toBe("BUDGETARY");
  });

  it("still requires a tenderNumber and dup-checks it for a real tender", async () => {
    await service.create(baseInput, ctx);
    await expect(service.create(baseInput, ctx)).rejects.toThrow(ConflictError);
  });

  it("links a real tender to a same-client budgetary quotation", async () => {
    const budgetary = await service.create(
      { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY" },
      ctx,
    );
    const real = await service.create(baseInput, ctx);

    const updated = await service.update(real.id, { convertedFromId: budgetary.id }, actorId, ctx);
    expect(updated.convertedFrom?.id).toBe(budgetary.id);
  });

  it("rejects linking to a tender that isn't a budgetary quotation", async () => {
    const otherReal = await service.create({ ...baseInput, tenderNumber: "TND-0002" }, ctx);
    const real = await service.create(baseInput, ctx);

    await expect(
      service.update(real.id, { convertedFromId: otherReal.id }, actorId, ctx),
    ).rejects.toThrow(BadRequestError);
  });

  it("rejects linking a budgetary quotation belonging to a different client", async () => {
    // Seeded directly into the fake's map rather than via service.create() — create() validates
    // clientId against FakeOrganizationsRepository, which only recognizes CLIENT_ID, so routing
    // a second client through create() would throw before this test ever reached update().
    const budgetary = buildTender({
      kind: "BUDGETARY",
      tenderNumber: "BQ-OTHER",
      client: { id: randomUUID(), name: "Different Client", type: "GOVERNMENT" },
    });
    tendersRepository.tenders.set(budgetary.id, budgetary);
    const real = await service.create(baseInput, ctx);

    await expect(
      service.update(real.id, { convertedFromId: budgetary.id }, actorId, ctx),
    ).rejects.toThrow(BadRequestError);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

```bash
pnpm --filter @bmp/server exec vitest run tenders.service.spec.ts
```

Expected: the four new tests fail (service doesn't yet support `kind`/`convertedFromId`), existing
tests still pass.

- [ ] **Step 7: Run the tests again to verify they pass**

Steps 1-4 already implement the code; re-run:

```bash
pnpm --filter @bmp/server exec vitest run tenders.service.spec.ts
```

Expected: all tests pass, including the four new ones and the untouched existing ones (duplicate
tender number, invalid client, status transitions).

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/tenders/tenders.repository.ts apps/server/src/modules/tenders/tenders.validation.ts apps/server/src/modules/tenders/tenders.service.ts apps/server/src/modules/tenders/tenders.mapper.ts apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts
git commit -m "feat(tenders): support BUDGETARY kind, auto-numbering, and linking to a real tender"
```

---

## Task 4: Tenders integration test — real-DB verification

**Files:**
- Modify: `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`

**Interfaces:**
- Consumes: `POST /tenders`, `PATCH /tenders/:id`, `GET /tenders?kind=` (Task 3, unchanged routes
  — only the validated body/query shape changed).

Requires `docker compose up -d postgres redis minio minio-init mailhog` and migrations applied to
`bmp_test` (`dotenv -e .env.test -- pnpm --filter @bmp/database migrate:deploy`, or however this
repo's existing integration suite is normally primed — check for a `pnpm test:integration:setup`
script before assuming; if none exists, apply the same migration from Task 1 against the test
database directly).

- [ ] **Step 1: Read the existing integration test's structure**

Open `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts` and find the
`describe("POST /tenders"...)`-style block (or equivalent) to match its exact `beforeEach`/
`afterEach` setup (test user, client org creation/cleanup) — reuse it rather than duplicating
setup, the same way Task 3's unit tests reused `FakeTendersRepository`.

- [ ] **Step 2: Add budgetary-numbering and linking integration tests**

Add a new `describe` block (adapt `testUser`/`clientOrgId`/cleanup variable names to whatever the
file's existing setup actually uses):

```ts
describe("budgetary quotations (integration)", () => {
  it("auto-generates a BQ-prefixed tenderNumber and omits it from the request", async () => {
    const response = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        title: "Rough estimate for client",
        clientId: clientOrgId,
        kind: "BUDGETARY",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.tenderNumber).toMatch(/^BQ-[0-9A-F]{8}$/);
    expect(response.body.data.kind).toBe("BUDGETARY");

    await prisma.tender.deleteMany({ where: { id: response.body.data.id } });
  });

  it("defaults GET /tenders to real tenders only when kind is specified", async () => {
    const budgetary = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ title: "Budgetary for filter test", clientId: clientOrgId, kind: "BUDGETARY" });

    const list = await request(app)
      .get("/api/v1/tenders")
      .query({ kind: "TENDER" })
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.items.some((t: { id: string }) => t.id === budgetary.body.data.id)).toBe(false);

    await prisma.tender.deleteMany({ where: { id: budgetary.body.data.id } });
  });

  it("links a real tender to a same-client budgetary quotation via PATCH", async () => {
    const budgetary = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ title: "Budgetary to link", clientId: clientOrgId, kind: "BUDGETARY" });

    const patch = await request(app)
      .patch(`/api/v1/tenders/${tenderId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ convertedFromId: budgetary.body.data.id });

    expect(patch.status).toBe(200);
    expect(patch.body.data.convertedFrom.id).toBe(budgetary.body.data.id);

    await prisma.tender.deleteMany({ where: { id: budgetary.body.data.id } });
  });
});
```

(`tenderId`/`clientOrgId`/`testUser`/`app`/`prisma`/`request` are whatever the existing file's
`beforeEach` already sets up — match those names exactly rather than the placeholders above if
they differ.)

- [ ] **Step 3: Run the integration suite**

```bash
docker compose up -d postgres redis minio minio-init mailhog
pnpm --filter @bmp/server exec vitest run tenders.integration.spec.ts
```

Expected: all tests pass (existing + the three new ones). If it fails with a `429`, run
`docker compose exec redis redis-cli FLUSHALL` first (login rate limiter from repeated runs — a
known gotcha, not a real bug) and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts
git commit -m "test(tenders): cover budgetary numbering, kind filtering, and linking end to end"
```

---

## Task 5: Quotation document generation (data + renderers)

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts`
- Create: `apps/server/src/modules/document-generation/quotation-document.ts`
- Test: Create `apps/server/src/modules/document-generation/__tests__/quotation-document.spec.ts`

**Interfaces:**
- Consumes: `ITendersRepository.findForDocumentGeneration` (existing), `IBoqRepository.findCurrentBoq`
  / `findItemsByBoqId` (existing, `apps/server/src/modules/boq/boq.repository.ts:110-115`),
  `buildBoqItemTree` (existing, `apps/server/src/modules/boq/boq.mapper.ts:25`), `getTemplateStatus`
  / `fillDocxTemplate` / `formatDate` (existing, this file, extended in Step 1).
- Produces: `generateQuotation(tendersRepository, boqRepository, tenderId, businessId, format):
  Promise<GeneratedQuotation>` with `{ buffer, filename, mimeType, tenderId, tenderNumber,
  tenderTitle, businessCode }` — consumed by Task 6's controller.

- [ ] **Step 1: Extend `DocumentType` to include `"quotation"`**

In `apps/server/src/modules/document-generation/document-generation.service.ts`, change line 12
and the `TEMPLATE_FILENAMES` map (lines 22-25):

```ts
export type DocumentType = "undertaking" | "signature" | "quotation";
```

```ts
const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
  signature: "signature.png",
  quotation: "quotation.docx",
};
```

- [ ] **Step 2: Write the failing tests for the row-building and CSV/PDF renderers**

Create `apps/server/src/modules/document-generation/__tests__/quotation-document.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import type { BoqItemDto } from "@bmp/types";

function item(overrides: Partial<BoqItemDto> = {}): BoqItemDto {
  return {
    id: "item-1",
    parentId: null,
    itemCode: "IT-1",
    description: "Widget",
    category: null,
    unit: "Nos",
    quantity: 10,
    rate: 100,
    amount: 1000,
    gstRate: 18,
    remarks: null,
    sortOrder: 0,
    rateBreakdown: null,
    normalizedName: null,
    aiCategory: null,
    aiSubcategory: null,
    aiConfidence: null,
    suggestedRate: null,
    aiSource: null,
    aiEnrichedAt: null,
    rateSourceConfirmed: false,
    children: [],
    ...overrides,
  };
}

describe("buildQuotationRows", () => {
  it("flattens a tree depth-first, indenting nested items", async () => {
    const { buildQuotationRows } = await import("../quotation-document.js");
    const tree = [
      item({ id: "a", description: "Group A", children: [item({ id: "a1", description: "Child 1" })] }),
      item({ id: "b", description: "Group B" }),
    ];

    const rows = buildQuotationRows(tree);

    expect(rows.map((r) => r.description)).toEqual(["Group A", "  Child 1", "Group B"]);
  });

  it("renders null quantity/rate/amount as blank strings", async () => {
    const { buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item({ quantity: null, rate: null, amount: null })]);

    expect(rows[0]).toMatchObject({ quantity: "", rate: "", amount: "" });
  });
});

describe("buildQuotationCsv", () => {
  it("produces a header row, one row per item, and a total row", async () => {
    const { buildQuotationCsv, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item()]);

    const csv = buildQuotationCsv(rows, 1000).toString("utf-8");
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Item Code,Description,Unit,Quantity,Rate,Amount");
    // amount formats as "1,000" (en-IN grouping) — its own comma makes escapeCsvField quote the
    // whole field, same as it would quote any description containing a comma.
    expect(lines[1]).toBe('IT-1,Widget,Nos,10,100,"1,000"');
    expect(lines[2]).toBe(',,,,Total,"1,000"');
  });

  it("quotes a description containing a comma", async () => {
    const { buildQuotationCsv, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item({ description: "Widget, large" })]);

    const csv = buildQuotationCsv(rows, 1000).toString("utf-8");

    expect(csv).toContain('"Widget, large"');
  });
});

describe("buildQuotationPdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const { buildQuotationPdf, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item()]);

    const buffer = await buildQuotationPdf(rows, 1000, {
      businessName: "Archie Udyog",
      tenderNumber: "TEN-001",
      tenderTitle: "Road Widening",
      clientName: "Acme Corp",
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("generateQuotation", () => {
  it("builds a csv from the tender's current BOQ", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const fakeBoqRepository = {
      findCurrentBoq: vi.fn().mockResolvedValue({ id: "boq-1" }),
      findItemsByBoqId: vi.fn().mockResolvedValue([item()]),
    };

    const { generateQuotation } = await import("../quotation-document.js");
    const result = await generateQuotation(
      fakeTendersRepository,
      fakeBoqRepository,
      "tender-1",
      "business-1",
      "csv",
    );

    expect(result.mimeType).toBe("text/csv");
    expect(result.filename).toMatch(/^Quotation-TEN-001-\d{2}-\d{2}-\d{4}\.csv$/);
    expect(result.buffer.toString("utf-8")).toContain("Widget");
    expect(fakeBoqRepository.findCurrentBoq).toHaveBeenCalledWith("tender-1", "business-1");
  });

  it("throws NotFoundError when the tender doesn't exist", async () => {
    const fakeTendersRepository = { findForDocumentGeneration: vi.fn().mockResolvedValue(null) };
    const fakeBoqRepository = { findCurrentBoq: vi.fn(), findItemsByBoqId: vi.fn() };

    const { generateQuotation } = await import("../quotation-document.js");
    await expect(
      generateQuotation(fakeTendersRepository, fakeBoqRepository, "missing", "business-1", "csv"),
    ).rejects.toThrow("Tender not found");
  });

  it("throws NotFoundError when the tender has no BOQ", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const fakeBoqRepository = { findCurrentBoq: vi.fn().mockResolvedValue(null), findItemsByBoqId: vi.fn() };

    const { generateQuotation } = await import("../quotation-document.js");
    await expect(
      generateQuotation(fakeTendersRepository, fakeBoqRepository, "tender-1", "business-1", "csv"),
    ).rejects.toThrow(/no boq/i);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm --filter @bmp/server exec vitest run quotation-document.spec.ts
```

Expected: fails with "Cannot find module '../quotation-document.js'" (doesn't exist yet).

- [ ] **Step 4: Implement `quotation-document.ts`**

Create `apps/server/src/modules/document-generation/quotation-document.ts`:

```ts
import { readFile } from "node:fs/promises";

import type { BoqItemDto } from "@bmp/types";
import PDFDocument from "pdfkit";

import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { round2 } from "../../shared/utils/math.js";
import { buildBoqItemTree } from "../boq/boq.mapper.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { fillDocxTemplate, formatDate, getTemplateStatus } from "./document-generation.service.js";

export type QuotationFormat = "docx" | "csv" | "pdf";

export interface QuotationRow {
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  amount: string;
}

export interface GeneratedQuotation {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  tenderId: string;
  tenderNumber: string;
  tenderTitle: string;
  businessCode: string;
}

const QUOTATION_MIME_TYPES: Record<QuotationFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  pdf: "application/pdf",
};

function flattenBoqItems(nodes: BoqItemDto[], depth = 0): Array<{ node: BoqItemDto; depth: number }> {
  const rows: Array<{ node: BoqItemDto; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    rows.push(...flattenBoqItems(node.children, depth + 1));
  }
  return rows;
}

function formatNumber(value: number | null): string {
  return value == null ? "" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** BOQ tree (as `buildBoqItemTree` produces) -> a flat, print-ordered row list. */
export function buildQuotationRows(items: BoqItemDto[]): QuotationRow[] {
  return flattenBoqItems(items).map(({ node, depth }) => ({
    itemCode: node.itemCode ?? "",
    description: `${"  ".repeat(depth)}${node.description}`,
    unit: node.unit ?? "",
    quantity: formatNumber(node.quantity),
    rate: formatNumber(node.rate),
    amount: formatNumber(node.amount),
  }));
}

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildQuotationCsv(rows: QuotationRow[], totalAmount: number): Buffer {
  const header = ["Item Code", "Description", "Unit", "Quantity", "Rate", "Amount"];
  const dataLines = rows.map((r) => [r.itemCode, r.description, r.unit, r.quantity, r.rate, r.amount]);
  const totalLine = ["", "", "", "", "Total", formatNumber(totalAmount)];
  const lines = [header, ...dataLines, totalLine].map((cols) => cols.map(escapeCsvField).join(","));
  return Buffer.from(lines.join("\r\n"), "utf-8");
}

// Fixed per-column widths sized for a description-heavy table (item descriptions in this app
// commonly run 140-180 chars — see rfq/quote-sheet.ts), with wrapped row heights computed via
// doc.heightOfString and page-break handling — same pattern as rfq/rfq-document.ts#buildRfrPdf.
// Deliberately not the reports module's exportTableToPdf (reports/reports.export.ts), which uses
// equal-width columns and a flat row height with no wrapping — wrong fit for this data.
const QUOTATION_COLUMN_HEADERS = ["Item Code", "Description", "Unit", "Qty", "Rate", "Amount"];
const QUOTATION_COLUMN_WIDTHS = [50, 220, 40, 45, 60, 70];

export function buildQuotationPdf(
  rows: QuotationRow[],
  totalAmount: number,
  header: { businessName: string; tenderNumber: string; tenderTitle: string; clientName: string },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(header.businessName, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).font("Helvetica-Bold").text(`Quotation: ${header.tenderTitle}`);
    doc.fontSize(9).font("Helvetica").text(`Tender Ref: ${header.tenderNumber}   Client: ${header.clientName}`);
    doc.moveDown();

    let y = doc.y;
    function columnX(index: number): number {
      return startX + QUOTATION_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }
    function drawRow(values: string[], bold: boolean) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const rowHeight = Math.max(
        16,
        ...values.map((value, index) => doc.heightOfString(value, { width: QUOTATION_COLUMN_WIDTHS[index]! }) + 4),
      );
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, { width: QUOTATION_COLUMN_WIDTHS[index]! });
      });
      y += rowHeight;
    }

    drawRow(QUOTATION_COLUMN_HEADERS, true);
    const tableWidth = QUOTATION_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 4;

    for (const row of rows) {
      drawRow([row.itemCode, row.description, row.unit, row.quantity, row.rate, row.amount], false);
    }
    y += 4;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 6;
    drawRow(["", "", "", "", "Total", formatNumber(totalAmount)], true);

    doc.end();
  });
}

export async function generateQuotation(
  tendersRepository: Pick<ITendersRepository, "findForDocumentGeneration">,
  boqRepository: Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">,
  tenderId: string,
  businessId: string,
  format: QuotationFormat,
): Promise<GeneratedQuotation> {
  const tender = await tendersRepository.findForDocumentGeneration(tenderId, businessId);
  if (!tender) throw new NotFoundError("Tender not found");

  const boq = await boqRepository.findCurrentBoq(tenderId, businessId);
  if (!boq) throw new NotFoundError("No BOQ found for this tender");

  const items = await boqRepository.findItemsByBoqId(boq.id);
  const rows = buildQuotationRows(buildBoqItemTree(items));
  const totalAmount = round2(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
  const generatedDate = formatDate(new Date());
  const filenameBase = `Quotation-${tender.tenderNumber}-${generatedDate}`;

  let buffer: Buffer;
  if (format === "csv") {
    buffer = buildQuotationCsv(rows, totalAmount);
  } else if (format === "pdf") {
    buffer = await buildQuotationPdf(rows, totalAmount, {
      businessName: tender.business.name,
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      clientName: tender.client.name,
    });
  } else {
    const status = await getTemplateStatus(tender.business.code, "quotation");
    if (!status.exists) {
      throw new NotFoundError(
        `Quotation template not found for ${tender.business.code}. Place it at ${status.path}`,
      );
    }
    const templateBuffer = await readFile(status.path);
    buffer = fillDocxTemplate(templateBuffer, {
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      businessName: tender.business.name,
      clientOrganizationName: tender.client.name,
      generatedDate,
      totalAmount: formatNumber(totalAmount),
      items: rows,
    });
  }

  return {
    buffer,
    filename: `${filenameBase}.${format}`,
    mimeType: QUOTATION_MIME_TYPES[format],
    tenderId,
    tenderNumber: tender.tenderNumber,
    tenderTitle: tender.title,
    businessCode: tender.business.code,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter @bmp/server exec vitest run quotation-document.spec.ts
```

Expected: all pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/document-generation/document-generation.service.ts apps/server/src/modules/document-generation/quotation-document.ts apps/server/src/modules/document-generation/__tests__/quotation-document.spec.ts
git commit -m "feat(document-generation): build Quotation rows and docx/csv/pdf renderers"
```

---

## Task 6: Quotation controller, routes, and folder persistence

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.controller.ts`
- Modify: `apps/server/src/modules/document-generation/document-generation.routes.ts`
- Modify: `apps/server/src/modules/document-generation/document-generation.module.ts`
- Modify: `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`

**Interfaces:**
- Consumes: `generateQuotation` (Task 5), `boqRepository` singleton (already exported from
  `apps/server/src/modules/boq/boq.module.ts:13`), `saveGeneratedTenderDocument` (existing,
  `apps/server/src/modules/tenders/local-docs/generated-documents.ts:33`).
- Produces: `POST /tenders/:id/documents/quotation?format=docx|csv|pdf`, gated by
  `tenders:generate_document` — consumed by Task 8's frontend `TenderDownloadMenu`.

- [ ] **Step 1: Controller — add `generateQuotation` handler**

In `apps/server/src/modules/document-generation/document-generation.controller.ts`:

```ts
import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import { saveGeneratedTenderDocument } from "../tenders/local-docs/generated-documents.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking } from "./document-generation.service.js";
import { generateQuotation, type QuotationFormat } from "./quotation-document.js";

const QUOTATION_FORMATS: QuotationFormat[] = ["docx", "csv", "pdf"];

export class DocumentGenerationController {
  constructor(
    private readonly tendersRepository: ITendersRepository,
    private readonly boqRepository: Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">,
  ) {}

  generateUndertaking = asyncHandler(async (req, res) => {
    const result = await generateUndertaking(this.tendersRepository, req.params.id!, req.user!.businessId);

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "UNDERTAKING",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploadedById: req.user!.id,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });

  generateQuotation = asyncHandler(async (req, res) => {
    const format = (req.query.format as string | undefined) ?? "pdf";
    if (!QUOTATION_FORMATS.includes(format as QuotationFormat)) {
      throw new BadRequestError("format must be one of: docx, csv, pdf");
    }

    const result = await generateQuotation(
      this.tendersRepository,
      this.boqRepository,
      req.params.id!,
      req.user!.businessId,
      format as QuotationFormat,
    );

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "QUOTATION",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: result.mimeType,
      uploadedById: req.user!.id,
    });

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });
}
```

- [ ] **Step 2: Routes — add the Quotation endpoint**

In `apps/server/src/modules/document-generation/document-generation.routes.ts`, add after the
existing undertaking route (before the closing `return router;`):

```ts
  /**
   * @openapi
   * /tenders/{id}/documents/quotation:
   *   post:
   *     tags: [Document Generation]
   *     summary: Generate a Quotation (docx, csv, or pdf) from a tender's current BOQ
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: format
   *         schema: { type: string, enum: [docx, csv, pdf] }
   *     responses:
   *       200: { description: Generated document }
   *       404: { description: Tender not found, or it has no BOQ (or the docx template is missing) }
   */
  router.post(
    "/:id/documents/quotation",
    authenticateMiddleware,
    requirePermission("tenders:generate_document"),
    controller.generateQuotation,
  );

  return router;
```

- [ ] **Step 3: Module — wire in `boqRepository`**

In `apps/server/src/modules/document-generation/document-generation.module.ts`:

```ts
import { boqRepository } from "../boq/boq.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { DocumentGenerationController } from "./document-generation.controller.js";
import { createDocumentGenerationRouter } from "./document-generation.routes.js";

const documentGenerationController = new DocumentGenerationController(tendersRepository, boqRepository);

export const documentGenerationRouter = createDocumentGenerationRouter(documentGenerationController);
```

- [ ] **Step 4: Add integration coverage**

In `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`,
add a new `describe` block after the existing `describe("POST /tenders/:id/documents/undertaking
(integration)", ...)` block, reusing the same `beforeAll`/`beforeEach`/`afterEach` setup pattern
(templates dir, test user, client org, tender) already in that file. Add a BOQ to the tender before
each test in this block:

```ts
describe("POST /tenders/:id/documents/quotation (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let clientOrgId: string;
  let tenderId: string;

  beforeEach(async () => {
    testUser = await createIntegrationTestUser(app);
    const clientOrg = await prisma.organization.create({
      data: { id: randomUUID(), name: "Quotation Client", type: "GOVERNMENT", createdById: testUser.userId },
    });
    clientOrgId = clientOrg.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `TEN-${randomUUID().slice(0, 8)}`,
        title: "Quotation Integration Tender",
        clientId: clientOrgId,
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
    const boqId = randomUUID();
    await prisma.boq.create({
      data: {
        id: boqId,
        tenderId,
        businessId: testUser.businessId,
        createdById: testUser.userId,
        groupId: boqId,
        version: 1,
        isCurrent: true,
        status: "DRAFT",
        items: {
          create: [
            {
              id: randomUUID(),
              itemCode: "IT-1",
              description: "Widget",
              unit: "Nos",
              quantity: 10,
              rate: 100,
              amount: 1000,
              sortOrder: 0,
            },
          ],
        },
      },
    });
  });

  afterEach(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await cleanupIntegrationTestUser(testUser);
  });

  it("generates a CSV of the current BOQ and returns 200", async () => {
    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/documents/quotation`)
      .query({ format: "csv" })
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .responseType("blob");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv");
    expect((response.body as Buffer).toString("utf-8")).toContain("Widget");
  });

  it("returns 404 when the tender has no BOQ", async () => {
    const noBoqTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `TEN-${randomUUID().slice(0, 8)}`,
        title: "No BOQ Tender",
        clientId: clientOrgId,
        createdById: testUser.userId,
      },
    });

    const response = await request(app)
      .post(`/api/v1/tenders/${noBoqTender.id}/documents/quotation`)
      .query({ format: "csv" })
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/no boq/i);

    await prisma.tender.deleteMany({ where: { id: noBoqTender.id } });
  });
});
```

- [ ] **Step 5: Run the integration suite**

```bash
docker compose up -d postgres redis minio minio-init mailhog
pnpm --filter @bmp/server exec vitest run document-generation.integration.spec.ts
```

Expected: all pass, including the pre-existing Undertaking tests (unaffected) and the two new
Quotation ones.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/document-generation/document-generation.controller.ts apps/server/src/modules/document-generation/document-generation.routes.ts apps/server/src/modules/document-generation/document-generation.module.ts apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts
git commit -m "feat(document-generation): wire the Quotation endpoint and persist it to the tender folder"
```

**Note for whoever deploys this:** the Word format needs an actual `quotation.docx` template at
`<BUSINESSES_ROOT_DIR>/<business code>/templates/quotation.docx`, same as `undertaking.docx`
already required for that format — it's a per-business file outside this repo, not something this
plan creates. It needs `{{tenderNumber}}`, `{{tenderTitle}}`, `{{businessName}}`,
`{{clientOrganizationName}}`, `{{generatedDate}}`, `{{totalAmount}}`, and a Docxtemplater
repeating-row loop over `items` (fields: `itemCode`, `description`, `unit`, `quantity`, `rate`,
`amount`) inside a table row, e.g. `{#items}` in the first cell of a row, `{/items}` in the last.
Until that file exists, Word-format requests 404 with a message naming the expected path — CSV and
PDF work immediately, no template needed.

---

## Task 7: Frontend — kind toggle on tender creation

**Files:**
- Modify: `apps/web/src/components/tenders/tender-form.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/new/page.tsx`
- Modify: `apps/web/src/lib/tender-status.ts`

**Interfaces:**
- Consumes: `TenderKind`, `TENDER_KIND_LABELS` (Task 2), `CreateTenderInput.kind` (Task 2).
- Produces: `TenderForm` accepts an optional `kind?: TenderKind` prop (presentational only, not a
  form field — the edit page never passes it, so editing an existing tender is unaffected).
  `kindBadgeVariant` helper for Task 9.

- [ ] **Step 1: `TenderForm` — accept a `kind` prop, make `tenderNumber` conditional**

In `apps/web/src/components/tenders/tender-form.tsx`, add the import:

```ts
import { TENDER_CATEGORIES, TENDER_PRIORITIES, TENDER_TYPES, type CreateTenderInput, type TenderKind } from "@bmp/types";
```

Change the schema (currently lines 51-72) to a function of whether `tenderNumber` is required:

```ts
function tenderFormSchema(requireTenderNumber: boolean) {
  return z.object({
    tenderNumber: requireTenderNumber
      ? z.string().min(1, "Required").max(100)
      : z.string().max(100).optional(),
    title: z.string().min(1, "Required").max(300),
    clientId: z.string().min(1, "Select a client"),
    department: z.string().max(150).optional(),
    type: z.string().optional(),
    category: z.string().optional(),
    location: z.string().max(200).optional(),
    state: z.string().max(100).optional(),
    estimatedCost: optionalNumericString,
    emdAmount: optionalNumericString,
    tenderFee: optionalNumericString,
    documentFee: optionalNumericString,
    submissionDate: z.string().optional(),
    openingDate: z.string().optional(),
    validityPeriodDays: optionalNumericString,
    priority: z.enum(TENDER_PRIORITIES),
    notes: z.string().optional(),
    dealingOfficerName: z.string().optional(),
    dealingOfficerEmail: z.string().optional(),
    dealingOfficerPhone: z.string().optional(),
  });
}

export type TenderFormValues = z.infer<ReturnType<typeof tenderFormSchema>>;
```

Add `kind` to `TenderFormProps` (currently lines 130-137) and default it in the component
signature (currently lines 139-145):

```ts
export interface TenderFormProps {
  defaultValues?: Partial<TenderFormValues>;
  onSubmit: (values: TenderFormValues) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Client name detected from document extraction but not matched to an existing organization. */
  suggestedClientName?: string;
  /** Purely presentational — hides the Tender Number field for a budgetary quotation (the server
   *  generates it). Not part of the form's own values; the edit page never passes this, so
   *  editing an existing tender is unaffected. */
  kind?: TenderKind;
}

export function TenderForm({
  defaultValues,
  onSubmit,
  isSubmitting = false,
  submitLabel = "Save",
  suggestedClientName,
  kind = "TENDER",
}: TenderFormProps) {
  const organizationsQuery = useOrganizations({ pageSize: 100 });

  const form = useForm<TenderFormValues>({
    resolver: zodResolver(tenderFormSchema(kind !== "BUDGETARY")),
    defaultValues: { ...DEFAULT_VALUES, ...defaultValues },
  });
  const watchedState = form.watch("state");
```

Wrap the `tenderNumber` `FormField` (currently lines 163-175) in a `kind !== "BUDGETARY"` guard:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
  {kind !== "BUDGETARY" && (
    <FormField
      control={form.control}
      name="tenderNumber"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Tender number</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )}
  <FormField
    control={form.control}
    name="department"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Department</FormLabel>
        <FormControl>
          <Input {...field} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
</div>
```

- [ ] **Step 2: New Tender page — add the toggle, pass `kind` through, merge it into the submit**

In `apps/web/src/app/(dashboard)/tenders/new/page.tsx`, add the import and local state:

```ts
import { TENDER_CATEGORIES, TENDER_KIND_LABELS, TENDER_TYPES, type ApiResponse, type BoqDto, type CommitBoqItemInput, type ExtractedTenderItem, type TenderExtractionResultDto, type TenderKind } from "@bmp/types";
```

```ts
export default function NewTenderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createTender = useCreateTender();
  const extract = useExtractTenderFromDocument();

  const [kind, setKind] = useState<TenderKind>("TENDER");
  const [defaultValues, setDefaultValues] = useState<Partial<TenderFormValues>>();
  const [formKey, setFormKey] = useState(0);
  // ...rest of the existing state declarations, unchanged
```

Change `handleSubmit` (currently lines 170-242) to merge `kind` into the create call:

```ts
async function handleSubmit(values: TenderFormValues) {
  try {
    const tender = await createTender.mutateAsync({ ...toCreateTenderInput(values), kind });
    // ...rest of the method body is unchanged (NIT upload, BOQ commit, toast, redirect)
```

Add the toggle card right after `<PageHeader .../>` (currently line 246), before the "Auto-fill
from a tender document" `<Card>`:

```tsx
<Card>
  <CardContent className="flex items-center gap-2 pt-6">
    {(["TENDER", "BUDGETARY"] as const).map((option) => (
      <Button
        key={option}
        type="button"
        variant={kind === option ? "default" : "outline"}
        size="sm"
        onClick={() => setKind(option)}
      >
        {TENDER_KIND_LABELS[option]}
      </Button>
    ))}
  </CardContent>
</Card>
```

Change the `<TenderForm>` call at the bottom (currently lines 337-344) to remount on `kind` change
(same technique the file already uses for `formKey` after document extraction) and pass `kind`
through:

```tsx
<TenderForm
  key={`${formKey}-${kind}`}
  kind={kind}
  defaultValues={defaultValues}
  onSubmit={handleSubmit}
  isSubmitting={createTender.isPending || isCommittingItems}
  submitLabel="Create tender"
  suggestedClientName={suggestedClientName}
/>
```

- [ ] **Step 3: `tender-status.ts` — add a kind badge helper**

In `apps/web/src/lib/tender-status.ts`, add the import and a new function:

```ts
import type { TenderKind, TenderPriority, TenderStatus } from "@bmp/types";
```

```ts
export function tenderKindBadgeVariant(kind: TenderKind): BadgeVariant {
  return kind === "BUDGETARY" ? "secondary" : "outline";
}
```

- [ ] **Step 4: Start the dev server and test manually**

```bash
pnpm dev
```

Open `/tenders/new`, toggle to "Budgetary Quotation" — confirm the Tender Number field
disappears and the form still submits (create succeeds, redirects to the new tender's detail
page). Toggle back to "Tender" — confirm the field reappears and is required again (submitting
blank shows the "Required" validation message). Then open an existing tender's `/edit` page and
confirm it looks and behaves exactly as before (no kind toggle, tenderNumber field present as
always) — the edit page never passes `kind`, so it defaults to `"TENDER"` and nothing changes
there.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/tenders/tender-form.tsx "apps/web/src/app/(dashboard)/tenders/new/page.tsx" apps/web/src/lib/tender-status.ts
git commit -m "feat(web): add a Tender / Budgetary Quotation toggle to tender creation"
```

---

## Task 8: Frontend — `TenderDownloadMenu` (detail page + list)

**Files:**
- Modify: `apps/web/src/hooks/use-document-generation.ts`
- Create: `apps/web/src/components/tenders/tender-download-menu.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`
- Modify: `apps/web/src/components/tenders/tender-table-columns.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/page.tsx`

**Interfaces:**
- Consumes: `POST /tenders/:id/documents/quotation?format=` (Task 6), `hasPermission` (existing,
  `apps/web/src/lib/permissions.ts`).
- Produces: `<TenderDownloadMenu tenderId tenderNumber />` — a single "Download" dropdown with
  Undertaking + Quotation (Word/CSV/PDF submenu). Used in two places in this task, and by Task 10
  (linked budgetary quotation card).

- [ ] **Step 1: Add `downloadQuotation` alongside the existing `downloadUndertaking`**

In `apps/web/src/hooks/use-document-generation.ts`:

```ts
"use client";

import { apiClient } from "@/lib/axios";

export async function downloadUndertaking(tenderId: string, tenderNumber: string): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/undertaking`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Undertaking-${tenderNumber}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadQuotation(
  tenderId: string,
  tenderNumber: string,
  format: "docx" | "csv" | "pdf",
): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/quotation?format=${format}`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Quotation-${tenderNumber}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Build the `TenderDownloadMenu` component**

Create `apps/web/src/components/tenders/tender-download-menu.tsx`:

```tsx
"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useToast,
} from "@bmp/ui";
import { Download } from "lucide-react";

import { downloadQuotation, downloadUndertaking } from "@/hooks/use-document-generation";

export function TenderDownloadMenu({
  tenderId,
  tenderNumber,
  size = "default",
  iconOnly = false,
}: {
  tenderId: string;
  tenderNumber: string;
  size?: "default" | "sm" | "icon";
  iconOnly?: boolean;
}) {
  const { toast } = useToast();

  async function handle(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not generate document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          <Download className={iconOnly ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {iconOnly ? null : "Download"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void handle(() => downloadUndertaking(tenderId, tenderNumber))}>
          Undertaking
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Quotation</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "docx"))}>
              Word (.docx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "csv"))}>
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "pdf"))}>
              PDF
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Replace the tender detail page's "Generate Undertaking" button**

In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`:

Remove the `downloadUndertaking` import (line 43) and `handleGenerateUndertaking` function
(currently lines 103-113) — no longer called from this file. Remove the now-unused `Download` icon
import if nothing else in the file uses it (check before removing — `Pencil, Receipt, ScrollText,
Trash2` are still used, `Download` was only used by the removed button). Add:

```ts
import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
```

Replace the button block (currently lines 162-166):

```tsx
{canGenerateDocument && <TenderDownloadMenu tenderId={tender.id} tenderNumber={tender.tenderNumber} />}
```

- [ ] **Step 4: Add a permission-gated row-actions column to the tenders table**

In `apps/web/src/components/tenders/tender-table-columns.tsx`, convert the const export to a
function and add an actions column:

```tsx
"use client";

import type { TenderListItemDto } from "@bmp/types";
import { TENDER_STATUS_LABELS } from "@bmp/types";
import { Badge, formatDate } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";

export function buildTenderTableColumns({
  canGenerateDocument,
}: {
  canGenerateDocument: boolean;
}): ColumnDef<TenderListItemDto>[] {
  const columns: ColumnDef<TenderListItemDto>[] = [
    {
      accessorKey: "tenderNumber",
      header: "Tender #",
      cell: ({ row }) => (
        <Link href={`/tenders/${row.original.id}`} className="font-medium hover:underline">
          {row.original.tenderNumber}
        </Link>
      ),
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => <span className="line-clamp-1">{row.original.title}</span>,
    },
    {
      accessorKey: "client",
      header: "Client",
      cell: ({ row }) => row.original.client.name,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={tenderStatusBadgeVariant(row.original.status)}>
          {TENDER_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => (
        <Badge variant={tenderPriorityBadgeVariant(row.original.priority)}>{row.original.priority}</Badge>
      ),
    },
    {
      accessorKey: "submissionDate",
      header: "Submission Date",
      cell: ({ row }) => formatDate(row.original.submissionDate),
    },
    {
      accessorKey: "assigneeCount",
      header: "Assignees",
    },
  ];

  if (canGenerateDocument) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <TenderDownloadMenu
            tenderId={row.original.id}
            tenderNumber={row.original.tenderNumber}
            size="sm"
            iconOnly
          />
        </div>
      ),
    });
  }

  return columns;
}
```

- [ ] **Step 5: Wire the permission flag into the tenders list page**

In `apps/web/src/app/(dashboard)/tenders/page.tsx`, replace the import and usage:

```ts
import { buildTenderTableColumns } from "@/components/tenders/tender-table-columns";
```

```ts
const canCreate = hasPermission(roleName, "tenders:create");
const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");
const hasActiveFilters = Boolean(debouncedSearch || status || priority);
```

```tsx
<DataTable
  columns={buildTenderTableColumns({ canGenerateDocument })}
  data={tendersQuery.data?.items ?? []}
  ...
```

- [ ] **Step 6: Start the dev server and test manually**

```bash
pnpm dev
```

Open a tender's detail page as a user with `tenders:generate_document` — confirm the "Download"
dropdown replaces "Generate Undertaking" and both Undertaking and all three Quotation formats
download successfully (check the downloaded CSV/PDF actually contain the tender's BOQ items).
Open the tenders list — confirm a download icon-button appears as the last column per row and
works the same way. Log in as a role without `tenders:generate_document` (e.g. `viewer@bmp.local`)
— confirm the button/column is absent in both places.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hooks/use-document-generation.ts apps/web/src/components/tenders/tender-download-menu.tsx "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx" apps/web/src/components/tenders/tender-table-columns.tsx "apps/web/src/app/(dashboard)/tenders/page.tsx"
git commit -m "feat(web): consolidate tender document downloads into one menu on detail + list pages"
```

---

## Task 9: Frontend — kind filter/tab and badge

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Consumes: `TENDER_KINDS`, `TENDER_KIND_LABELS` (Task 2), `tenderKindBadgeVariant` (Task 7),
  `kind` query param (Task 3).
- Produces: default tenders list view excludes `BUDGETARY`; a toggle switches to it. Tender detail
  page shows a kind badge.

- [ ] **Step 1: Add the kind filter to the tenders list page**

In `apps/web/src/app/(dashboard)/tenders/page.tsx`, add the import and state:

```ts
import { TENDER_KIND_LABELS, TENDER_KINDS, TENDER_PRIORITIES, TENDER_STATUS_LABELS, TENDER_STATUSES, type TenderKind, type TenderPriority, type TenderStatus } from "@bmp/types";
```

```ts
const [kind, setKind] = useState<TenderKind>("TENDER");
```

Add `kind` to the `useTenders()` call:

```ts
const tendersQuery = useTenders({
  page: pagination.pageIndex + 1,
  pageSize: pagination.pageSize,
  search: debouncedSearch || undefined,
  status: (status || undefined) as TenderStatus | undefined,
  priority: (priority || undefined) as TenderPriority | undefined,
  kind,
});
```

Add a kind toggle to the `<FilterBar>` (before the search `<Input>`), and reset pagination on
change like the other filters do:

```tsx
<FilterBar>
  <div className="flex gap-1">
    {TENDER_KINDS.map((option) => (
      <Button
        key={option}
        type="button"
        variant={kind === option ? "default" : "outline"}
        size="sm"
        onClick={() => {
          setKind(option);
          setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        }}
      >
        {TENDER_KIND_LABELS[option]}
      </Button>
    ))}
  </div>
  <Input
    placeholder="Search by title or tender number..."
    ...
```

Update the page title/description and the "New Tender" button's empty-state copy to stay accurate
when viewing budgetary quotations — this is a small, optional polish; at minimum, leave the
existing "Tenders" title as-is (the toggle itself makes the current view clear) rather than adding
conditional copy nobody asked for.

- [ ] **Step 2: Add a kind badge to the tender detail page header**

In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, add the import:

```ts
import { tenderKindBadgeVariant, tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";
import { TENDER_KIND_LABELS, TENDER_STATUS_LABELS } from "@bmp/types";
```

Add the badge next to the existing status/priority badges (currently lines 130-136):

```tsx
<div className="flex items-center gap-2">
  <h1 className="text-2xl font-semibold tracking-tight">{tender.title}</h1>
  {tender.kind === "BUDGETARY" && (
    <Badge variant={tenderKindBadgeVariant(tender.kind)}>{TENDER_KIND_LABELS.BUDGETARY}</Badge>
  )}
  <Badge variant={tenderStatusBadgeVariant(tender.status)}>
    {TENDER_STATUS_LABELS[tender.status]}
  </Badge>
  <Badge variant={tenderPriorityBadgeVariant(tender.priority)}>{tender.priority}</Badge>
</div>
```

- [ ] **Step 3: Start the dev server and test manually**

```bash
pnpm dev
```

Confirm the tenders list defaults to showing only real tenders (no `BQ-...` numbers), toggling to
"Budgetary Quotation" shows only those, and pagination resets on toggle. Open a budgetary
quotation's detail page — confirm the "Budgetary Quotation" badge appears next to the title.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/tenders/page.tsx" "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx"
git commit -m "feat(web): filter the tenders list by kind and badge budgetary quotations"
```

---

## Task 10: Frontend — linked budgetary quotation picker + card

**Files:**
- Create: `apps/web/src/components/tenders/linked-budgetary-quotation-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Consumes: `PATCH /tenders/:id` with `convertedFromId` (Task 3), `GET /tenders?kind=BUDGETARY&clientId=`
  (Task 3), `TenderDownloadMenu` (Task 8), `TenderLinkedBudgetaryDto` (Task 2),
  `useUpdateTender(id: string)` (existing — `apps/web/src/hooks/use-tenders.ts:76-87` — already
  takes a plain `UpdateTenderInput` body, which now includes `convertedFromId` per Task 2's
  `packages/types/src/tender.ts` change. No changes needed to this hook.)
- Produces: a self-contained card component, rendered only on `TENDER`-kind tenders.

- [ ] **Step 1: Build the linked-budgetary-quotation card**

Create `apps/web/src/components/tenders/linked-budgetary-quotation-card.tsx`:

```tsx
"use client";

import type { TenderLinkedBudgetaryDto } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  formatDate,
  useToast,
} from "@bmp/ui";
import Link from "next/link";
import { useState } from "react";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { useTenders, useUpdateTender } from "@/hooks/use-tenders";

export function LinkedBudgetaryQuotationCard({
  tenderId,
  clientId,
  convertedFrom,
}: {
  tenderId: string;
  clientId: string;
  convertedFrom: TenderLinkedBudgetaryDto | null;
}) {
  const { toast } = useToast();
  const updateTender = useUpdateTender(tenderId);
  const [picking, setPicking] = useState(false);

  const budgetaryQuery = useTenders({ kind: "BUDGETARY", clientId, pageSize: 50 });

  async function link(budgetaryTenderId: string) {
    try {
      await updateTender.mutateAsync({ convertedFromId: budgetaryTenderId || null });
      setPicking(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not link the budgetary quotation",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (convertedFrom && !picking) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">Linked budgetary quotation</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
            Change
          </Button>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <Link href={`/tenders/${convertedFrom.id}`} className="font-medium hover:underline">
              {convertedFrom.tenderNumber}
            </Link>
            <p className="text-sm text-muted-foreground">
              {convertedFrom.title} · updated {formatDate(convertedFrom.updatedAt)}
            </p>
          </div>
          <TenderDownloadMenu tenderId={convertedFrom.id} tenderNumber={convertedFrom.tenderNumber} size="sm" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked budgetary quotation</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Select onValueChange={(value) => void link(value)}>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Link a prior budgetary quotation for this client..." />
          </SelectTrigger>
          <SelectContent>
            {budgetaryQuery.data?.items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.tenderNumber} — {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {convertedFrom && (
          <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Render the card on the tender detail page (TENDER-kind only)**

In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, add the import:

```ts
import { LinkedBudgetaryQuotationCard } from "@/components/tenders/linked-budgetary-quotation-card";
```

Render it below the header block, before the `<Tabs>` (find where the header `<div>` closes,
currently around line 176-180 — place this immediately after):

```tsx
{tender.kind === "TENDER" && canUpdate && (
  <LinkedBudgetaryQuotationCard
    tenderId={tender.id}
    clientId={tender.client.id}
    convertedFrom={tender.convertedFrom}
  />
)}
```

- [ ] **Step 3: Start the dev server and test manually**

```bash
pnpm dev
```

Create a budgetary quotation for a client, then create a real tender for the same client. On the
real tender's detail page, confirm the "Linked budgetary quotation" card appears with a picker
listing the budgetary quotation; select it, confirm it links (card switches to the linked view)
and its "Download" menu works. Click "Change", confirm you can re-pick or cancel. Confirm the card
does *not* appear on the budgetary quotation's own detail page (`kind === "BUDGETARY"`).

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/tenders/linked-budgetary-quotation-card.tsx "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx"
git commit -m "feat(web): let a tender link back to the budgetary quotation it grew from"
```

---

## Task 11: Frontend — `RfqDownloadMenu`

**Files:**
- Create: `apps/web/src/components/rfq/rfq-download-menu.tsx`
- Modify: `apps/web/src/components/rfq/quote-sheet-actions.tsx`

**Interfaces:**
- Consumes: `GET /rfqs/:id/quote-sheet`, `GET /rfqs/:id/documents/pdf`, `GET
  /rfqs/:id/documents/word` (existing, unchanged), `downloadFile` (existing,
  `apps/web/src/lib/download.ts`).
- Produces: a single "Download" dropdown replacing the three standalone buttons in
  `QuoteSheetActions`; the vendor-select + import-upload controls in that file are untouched
  (they aren't downloads).

- [ ] **Step 1: Build `RfqDownloadMenu`**

Create `apps/web/src/components/rfq/rfq-download-menu.tsx`:

```tsx
"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bmp/ui";
import { Download } from "lucide-react";

import { downloadFile } from "@/lib/download";

export function RfqDownloadMenu({ rfqId }: { rfqId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="mr-2 h-4 w-4" /> Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/quote-sheet`, `quotes-${rfqId}.xlsx`)}
        >
          Quote sheet (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/documents/word`, `RFR-${rfqId}.docx`)}
        >
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/documents/pdf`, `RFR-${rfqId}.pdf`)}
        >
          PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Replace the three download buttons in `QuoteSheetActions`**

In `apps/web/src/components/rfq/quote-sheet-actions.tsx`:

Remove the `download`/`downloadPdf`/`downloadWord` functions (currently lines 30-38) and the three
`<Button>...Download...</Button>` elements (currently the three buttons right after the opening
`<div className="flex flex-wrap items-center gap-2">`). Add the import:

```ts
import { RfqDownloadMenu } from "@/components/rfq/rfq-download-menu";
```

Result:

```tsx
"use client";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { RfqDownloadMenu } from "@/components/rfq/rfq-download-menu";
import { useImportQuotes } from "@/hooks/use-rfq";

export function QuoteSheetActions({
  rfqId,
  vendors,
}: {
  rfqId: string;
  vendors: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const importQuotes = useImportQuotes(rfqId);

  async function onFile(file: File) {
    try {
      const result = await importQuotes.mutateAsync({ vendorId, file });
      toast({
        title: `Imported ${result.imported} quote(s)`,
        ...(result.errors.length > 0
          ? { variant: "destructive" as const, description: result.errors.slice(0, 3).join("; ") }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import quotes",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <RfqDownloadMenu rfqId={rfqId} />

      {vendors.length > 0 && (
        <>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Vendor to import for" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            disabled={!vendorId || importQuotes.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> Import filled sheet
          </Button>
        </>
      )}
    </div>
  );
}
```

(Note `Download` is dropped from the `lucide-react` import since only `Upload` is used directly in
this file now — the download icon lives inside `RfqDownloadMenu`.)

- [ ] **Step 3: Start the dev server and test manually**

```bash
pnpm dev
```

Open an RFQ detail page — confirm one "Download" dropdown replaces the three buttons, and all
three items (quote sheet, Word, PDF) still download correctly. Confirm the vendor-select + "Import
filled sheet" controls are unaffected.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/rfq/rfq-download-menu.tsx apps/web/src/components/rfq/quote-sheet-actions.tsx
git commit -m "feat(web): consolidate RFQ document downloads into one menu"
```

---

## Final verification

- [ ] Run the full test suite: `pnpm test` (or `pnpm --filter @bmp/server test` +
  `pnpm --filter @bmp/web test` if the root script doesn't include integration tests by default —
  check `package.json`/`turbo.json` first).
- [ ] Run the full typecheck: `pnpm typecheck`.
- [ ] Run the full lint: `pnpm lint`.
- [ ] Manual end-to-end pass: create a budgetary quotation → price its BOQ → download all three
  Quotation formats → confirm the files land in
  `<BUSINESSES_ROOT_DIR>/<business>/tenders/<BQ number> - <title>/Quotations/` (requires
  `LOCAL_DOCS_SYNC_ENABLED=true`) → create a real tender for the same client → link it to the
  budgetary quotation → confirm the linked card and both quotations are reachable from the real
  tender's page.
