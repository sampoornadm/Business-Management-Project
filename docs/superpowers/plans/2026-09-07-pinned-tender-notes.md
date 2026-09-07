# Pinned Tender Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click individual lines of a tender's Terms & Notes to pin them into a dedicated
"Pinned" section at the top, persist the pins, and carry pinned lines into a tender-linked RFQ's
outbound Word/PDF request-for-rates documents.

**Architecture:** A new `TenderPinnedNote` table (one row per pinned line, `lineText` itself is the
identity via a `(tenderId, lineText)` unique constraint) exposed through two new sub-resource routes
on the existing tenders module, following the exact `TenderCompetitor` add/delete shape already in
this codebase. The frontend adds hover-to-reveal pin controls to the existing notes renderer and a
new small component for the pinned list, both driven by two new TanStack Query mutation hooks. The
RFQ module's already-shared `loadRfrDocumentData` helper picks up one more field from the tender it
already loads, threading it into the existing PDF (pdfkit) and Word (Docxtemplater) builders.

**Tech Stack:** Prisma/PostgreSQL, Express/Zod, React/TanStack Query, pdfkit, Docxtemplater/PizZip.

**Spec:** `docs/superpowers/specs/2026-09-07-pinned-tender-notes-design.md`

## Global Constraints

- No new RBAC permission key — every pinned-notes route is gated by the existing `tenders:update`
  permission, same as competitors/tags/assignees.
- `lineText` is the pin's identity (not a hash or line index) — a `(tenderId, lineText)` unique
  constraint prevents duplicate pins; duplicate-pin attempts are rejected via a check-then-insert
  (`findPinnedNote` then `ConflictError`), never a caught DB constraint error.
- Every pin/unpin mutation ends by returning the full `TenderDto` (via `this.getById(...)`), matching
  every other tender sub-resource mutation in this codebase (`addCompetitor`, `addAssignee`, etc).
- Every pin/unpin mutation logs to `AuditService` with `metadata: { lineText }` — action names
  `TENDER_NOTE_PINNED` / `TENDER_NOTE_UNPINNED`.
- Pinned notes reach RFQ vendor-facing documents in the PDF and Word RFR builders only — never the
  invite-email text, never the Excel quote sheet.
- `Loader2` + `animate-spin` is this codebase's established pending-mutation convention (see
  `tender-download-menu.tsx`) — reuse it for pin/unpin, not a new spinner.
- No `Tooltip` component exists in `packages/ui` — use the native `title` attribute for hover hints,
  matching `tender-download-menu.tsx`'s existing precedent.

---

## Task 1: Prisma schema — `TenderPinnedNote` model

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260907120000_add_tender_pinned_notes/migration.sql`

**Interfaces:**
- Produces: Prisma model `TenderPinnedNote` (table `tender_pinned_notes`), `Tender.pinnedNotes`
  relation, `User.pinnedTenderNotes` relation. Later tasks' repository/service code consumes
  `prisma.tenderPinnedNote` and the `pinnedNotes` include on `Tender`.

There is no automated test for a schema-only change in this codebase (no `*.schema.spec.ts`
convention exists) — verification is `pnpm db:generate` succeeding and the server package
typechecking cleanly with the new (still-unused) generated types.

- [ ] **Step 1: Add the `pinnedNotes` relation field to `Tender`**

  In `packages/database/prisma/schema.prisma`, find the `Tender` model's relation block:

  ```prisma
    assignees      TenderAssignee[]
    competitors    TenderCompetitor[]
    tags           TenderTag[]
    boqs           Boq[]
  ```

  Change it to:

  ```prisma
    assignees      TenderAssignee[]
    competitors    TenderCompetitor[]
    tags           TenderTag[]
    pinnedNotes    TenderPinnedNote[]
    boqs           Boq[]
  ```

- [ ] **Step 2: Add the `pinnedTenderNotes` relation field to `User`**

  Find the `User` model's tender-related relation block near the top of the schema:

  ```prisma
    createdTenders         Tender[]               @relation("TenderCreatedBy")
    tenderAssignments      TenderAssignee[]       @relation("TenderAssignee")
    tenderAssignmentsGiven TenderAssignee[]       @relation("TenderAssignedBy")
  ```

  Change it to:

  ```prisma
    createdTenders         Tender[]               @relation("TenderCreatedBy")
    tenderAssignments      TenderAssignee[]       @relation("TenderAssignee")
    tenderAssignmentsGiven TenderAssignee[]       @relation("TenderAssignedBy")
    pinnedTenderNotes      TenderPinnedNote[]      @relation("TenderPinnedBy")
  ```

- [ ] **Step 3: Add the `TenderPinnedNote` model**

  In `packages/database/prisma/schema.prisma`, find the `TenderCompetitor` model (it ends just
  before the `// Notifications` section comment):

  ```prisma
  model TenderCompetitor {
    id             String  @id @default(uuid())
    tenderId       String
    tender         Tender  @relation(fields: [tenderId], references: [id], onDelete: Cascade)
    competitorName String
    bidAmount      Float?
    isWinningBid   Boolean @default(false)
    remarks        String?

    createdAt DateTime @default(now())

    @@index([tenderId])
    @@map("tender_competitors")
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  ```

  Insert a new model between them, so the file reads:

  ```prisma
  model TenderCompetitor {
    id             String  @id @default(uuid())
    tenderId       String
    tender         Tender  @relation(fields: [tenderId], references: [id], onDelete: Cascade)
    competitorName String
    bidAmount      Float?
    isWinningBid   Boolean @default(false)
    remarks        String?

    createdAt DateTime @default(now())

    @@index([tenderId])
    @@map("tender_competitors")
  }

  // lineText (the full trimmed line, exactly as TenderNotesView renders it — bullet marker
  // already stripped) is the pin's identity, not a separate hash or line index. If a tender's
  // notes are ever re-extracted and change, pins for lines that no longer exist simply stop
  // matching anything on render and quietly disappear — no migration, no dangling reference.
  model TenderPinnedNote {
    id       String @id @default(uuid())
    tenderId String
    tender   Tender @relation(fields: [tenderId], references: [id], onDelete: Cascade)
    lineText String

    pinnedById String
    pinnedBy   User   @relation("TenderPinnedBy", fields: [pinnedById], references: [id], onDelete: Restrict)

    createdAt DateTime @default(now())

    @@unique([tenderId, lineText])
    @@index([tenderId])
    @@map("tender_pinned_notes")
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  ```

- [ ] **Step 4: Write the migration by hand**

  Per this repo's documented pgvector-drift gotcha, plain `prisma migrate dev` on this schema
  triggers an interactive corrective-migration prompt that must never be accepted. Write the SQL
  file directly instead (mirrors `20260903190000_add_tender_kind_and_conversion/migration.sql`'s
  precedent). Create `packages/database/prisma/migrations/20260907120000_add_tender_pinned_notes/migration.sql`:

  ```sql
  -- CreateTable
  CREATE TABLE "tender_pinned_notes" (
      "id" TEXT NOT NULL,
      "tenderId" TEXT NOT NULL,
      "lineText" TEXT NOT NULL,
      "pinnedById" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "tender_pinned_notes_pkey" PRIMARY KEY ("id")
  );

  -- CreateIndex
  CREATE INDEX "tender_pinned_notes_tenderId_idx" ON "tender_pinned_notes"("tenderId");

  -- CreateIndex
  CREATE UNIQUE INDEX "tender_pinned_notes_tenderId_lineText_key" ON "tender_pinned_notes"("tenderId", "lineText");

  -- AddForeignKey
  ALTER TABLE "tender_pinned_notes" ADD CONSTRAINT "tender_pinned_notes_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  -- AddForeignKey
  ALTER TABLE "tender_pinned_notes" ADD CONSTRAINT "tender_pinned_notes_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  ```

- [ ] **Step 5: Apply the migration and regenerate the Prisma client**

  Run: `pnpm --filter @bmp/database exec prisma migrate deploy`
  Then: `pnpm db:generate`

  Expected: migration applies cleanly (no drift prompt — `migrate deploy` never triggers one), and
  `packages/database/generated/client` now has a `tenderPinnedNote` delegate.

- [ ] **Step 6: Verify the server package still typechecks**

  Run: `pnpm --filter @bmp/server typecheck`
  Expected: PASS (the new model/relations are additive and not yet referenced by any code).

- [ ] **Step 7: Commit**

  ```bash
  git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/20260907120000_add_tender_pinned_notes
  git commit -m "feat(database): add TenderPinnedNote model"
  ```

---

## Task 2: Backend API — pin/unpin routes

**Files:**
- Modify: `packages/types/src/tender.ts`
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`
- Modify: `apps/server/src/modules/tenders/tenders.mapper.ts`
- Modify: `apps/server/src/modules/tenders/tenders.validation.ts`
- Modify: `apps/server/src/modules/tenders/tenders.routes.ts`
- Modify: `apps/server/src/modules/tenders/tenders.controller.ts`
- Test: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.tenderPinnedNote` delegate (Task 1), `ConflictError`/`NotFoundError` from
  `../../core/errors/HttpErrors.js`, `AuditService.log({ actorId, action, entityType, entityId,
  metadata })` (`../audit/audit.service.js`).
- Produces: `TendersService#pinNote(tenderId: string, lineText: string, actorId: string, businessId:
  string): Promise<TenderDto>` and `#unpinNote(tenderId: string, pinnedNoteId: string, actorId:
  string, businessId: string): Promise<TenderDto>`, both consumed by Task 6's page wiring via new
  hooks from Task 3. `TenderDto.pinnedNotes: TenderPinnedNoteDto[]` (`{ id: string; lineText: string
  }[]`) consumed by Tasks 4-6.

- [ ] **Step 1: Add the DTO/input types to `packages/types/src/tender.ts`**

  Add this new interface right after `TenderTagDto`:

  ```ts
  export interface TenderPinnedNoteDto {
    id: string;
    lineText: string;
  }
  ```

  Add `pinnedNotes` to `TenderDto`, right after the existing `competitors` field:

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
    pinnedNotes: TenderPinnedNoteDto[];
    tags: TenderTagDto[];
    updatedAt: string;
  }
  ```

  Add this new interface right after `UpdateTenderCompetitorInput`:

  ```ts
  export interface PinTenderNoteInput {
    lineText: string;
  }
  ```

- [ ] **Step 2: Add the repository methods**

  In `apps/server/src/modules/tenders/tenders.repository.ts`, add `pinnedNotes` to `tenderDetailArgs`
  (right after `competitors`, before `tags`):

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
      pinnedNotes: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true } },
      convertedFrom: { select: { id: true, tenderNumber: true, title: true, updatedAt: true } },
    },
  } satisfies Prisma.TenderDefaultArgs;
  ```

  Add these four method signatures to the `ITendersRepository` interface, right after
  `deleteCompetitor(id: string): Promise<void>;`:

  ```ts
    findPinnedNote(tenderId: string, lineText: string): Promise<{ id: string } | null>;
    findPinnedNoteById(id: string): Promise<{ id: string; tenderId: string; lineText: string } | null>;
    addPinnedNote(tenderId: string, lineText: string, pinnedById: string): Promise<void>;
    removePinnedNote(id: string): Promise<void>;
  ```

  Add the implementations to the `TendersRepository` class, right after `deleteCompetitor`:

  ```ts
    findPinnedNote(tenderId: string, lineText: string): Promise<{ id: string } | null> {
      return this.prisma.tenderPinnedNote.findUnique({
        where: { tenderId_lineText: { tenderId, lineText } },
        select: { id: true },
      });
    }

    findPinnedNoteById(id: string): Promise<{ id: string; tenderId: string; lineText: string } | null> {
      return this.prisma.tenderPinnedNote.findUnique({
        where: { id },
        select: { id: true, tenderId: true, lineText: true },
      });
    }

    async addPinnedNote(tenderId: string, lineText: string, pinnedById: string): Promise<void> {
      await this.prisma.tenderPinnedNote.create({
        data: { id: randomUUID(), tenderId, lineText, pinnedById },
      });
    }

    async removePinnedNote(id: string): Promise<void> {
      await this.prisma.tenderPinnedNote.delete({ where: { id } });
    }
  ```

- [ ] **Step 3: Add `toPinnedNoteDto` and wire it into `toTenderDto`**

  In `apps/server/src/modules/tenders/tenders.mapper.ts`, add `TenderPinnedNoteDto` to the type
  import at the top of the file:

  ```ts
  import type {
    TenderAssigneeDto,
    TenderCompetitorDto,
    TenderDto,
    TenderListItemDto,
    TenderPinnedNoteDto,
    TenderTagDto,
  } from "@bmp/types";
  ```

  Add this function right after `toCompetitorDto`:

  ```ts
  function toPinnedNoteDto(entity: TenderDetail["pinnedNotes"][number]): TenderPinnedNoteDto {
    return { id: entity.id, lineText: entity.lineText };
  }
  ```

  Add `pinnedNotes` to the object `toTenderDto` returns, right after `competitors`:

  ```ts
    competitors: entity.competitors.map(toCompetitorDto),
    pinnedNotes: entity.pinnedNotes.map(toPinnedNoteDto),
    tags: entity.tags.map(toTagDto),
  ```

- [ ] **Step 4: Add the Zod schema**

  In `apps/server/src/modules/tenders/tenders.validation.ts`, add this right after
  `updateCompetitorSchema`/`UpdateCompetitorBody`:

  ```ts
  export const pinTenderNoteSchema = z.object({
    lineText: z.string().min(1).max(2000),
  });
  export type PinTenderNoteBody = z.infer<typeof pinTenderNoteSchema>;
  ```

- [ ] **Step 5: Write the failing service tests**

  In `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`:

  Add `pinnedNotes: []` to the `buildTender()` default object (right after `competitors: [],`):

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
      pinnedNotes: [],
      tags: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as TenderDetail;
  }
  ```

  Add these four methods to `FakeTendersRepository`, right after `deleteCompetitor`:

  ```ts
    async findPinnedNote(tenderId: string, lineText: string) {
      const tender = this.tenders.get(tenderId);
      const pinned = tender?.pinnedNotes.find((p) => p.lineText === lineText);
      return pinned ? { id: pinned.id } : null;
    }

    async findPinnedNoteById(id: string) {
      for (const tender of this.tenders.values()) {
        const pinned = tender.pinnedNotes.find((p) => p.id === id);
        if (pinned) return { id: pinned.id, tenderId: tender.id, lineText: pinned.lineText };
      }
      return null;
    }

    async addPinnedNote(tenderId: string, lineText: string, pinnedById: string) {
      const tender = this.tenders.get(tenderId);
      if (!tender) throw new Error("not found");
      tender.pinnedNotes.push({
        id: randomUUID(),
        tenderId,
        lineText,
        pinnedById,
        createdAt: new Date(),
      } as never);
    }

    async removePinnedNote(id: string) {
      for (const tender of this.tenders.values()) {
        tender.pinnedNotes = tender.pinnedNotes.filter((p) => p.id !== id) as never;
      }
    }
  ```

  Add this test block at the end of the `describe("TendersService", ...)` block, right before its
  closing `});`:

  ```ts
    describe("pinNote / unpinNote", () => {
      it("pins a note and returns it in the tender's pinnedNotes", async () => {
        const created = await service.create(baseInput, ctx);
        const dto = await service.pinNote(created.id, "Delivery within 30 days", actorId, BUSINESS_ID);
        expect(dto.pinnedNotes).toHaveLength(1);
        expect(dto.pinnedNotes[0]!.lineText).toBe("Delivery within 30 days");
        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "TENDER_NOTE_PINNED",
            entityId: created.id,
            metadata: { lineText: "Delivery within 30 days" },
          }),
        );
      });

      it("rejects pinning the same line twice", async () => {
        const created = await service.create(baseInput, ctx);
        await service.pinNote(created.id, "Delivery within 30 days", actorId, BUSINESS_ID);
        await expect(
          service.pinNote(created.id, "Delivery within 30 days", actorId, BUSINESS_ID),
        ).rejects.toThrow(ConflictError);
      });

      it("unpins a note", async () => {
        const created = await service.create(baseInput, ctx);
        const pinned = await service.pinNote(created.id, "Delivery within 30 days", actorId, BUSINESS_ID);
        const pinnedNoteId = pinned.pinnedNotes[0]!.id;

        const dto = await service.unpinNote(created.id, pinnedNoteId, actorId, BUSINESS_ID);
        expect(dto.pinnedNotes).toHaveLength(0);
        expect(auditService.log).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "TENDER_NOTE_UNPINNED",
            entityId: created.id,
            metadata: { lineText: "Delivery within 30 days" },
          }),
        );
      });

      it("rejects unpinning a pinned-note id that belongs to a different tender", async () => {
        const created = await service.create(baseInput, ctx);
        const other = await service.create({ ...baseInput, tenderNumber: "TND-0002" }, ctx);
        const pinned = await service.pinNote(other.id, "Some line", actorId, BUSINESS_ID);
        const pinnedNoteId = pinned.pinnedNotes[0]!.id;

        await expect(
          service.unpinNote(created.id, pinnedNoteId, actorId, BUSINESS_ID),
        ).rejects.toThrow(NotFoundError);
      });
    });
  ```

- [ ] **Step 6: Run the tests to verify they fail**

  Run: `pnpm --filter @bmp/server test tenders.service.spec.ts`
  Expected: FAIL — `service.pinNote is not a function` (method doesn't exist yet).

- [ ] **Step 7: Implement `pinNote` / `unpinNote` on `TendersService`**

  In `apps/server/src/modules/tenders/tenders.service.ts`, add these two methods and one private
  helper right after `deleteCompetitor`:

  ```ts
    async pinNote(
      tenderId: string,
      lineText: string,
      actorId: string,
      businessId: string,
    ): Promise<TenderDto> {
      await this.assertTenderExists(tenderId, businessId);
      const existing = await this.tendersRepository.findPinnedNote(tenderId, lineText);
      if (existing) throw new ConflictError("This line is already pinned");

      await this.tendersRepository.addPinnedNote(tenderId, lineText, actorId);
      await this.auditService.log({
        actorId,
        action: "TENDER_NOTE_PINNED",
        entityType: "Tender",
        entityId: tenderId,
        metadata: { lineText },
      });
      return this.getById(tenderId, businessId);
    }

    private async assertPinnedNoteBelongsToTender(tenderId: string, pinnedNoteId: string) {
      const pinnedNote = await this.tendersRepository.findPinnedNoteById(pinnedNoteId);
      if (!pinnedNote || pinnedNote.tenderId !== tenderId) {
        throw new NotFoundError("Pinned note not found for this tender");
      }
      return pinnedNote;
    }

    async unpinNote(
      tenderId: string,
      pinnedNoteId: string,
      actorId: string,
      businessId: string,
    ): Promise<TenderDto> {
      await this.assertTenderExists(tenderId, businessId);
      const pinnedNote = await this.assertPinnedNoteBelongsToTender(tenderId, pinnedNoteId);

      await this.tendersRepository.removePinnedNote(pinnedNoteId);
      await this.auditService.log({
        actorId,
        action: "TENDER_NOTE_UNPINNED",
        entityType: "Tender",
        entityId: tenderId,
        metadata: { lineText: pinnedNote.lineText },
      });
      return this.getById(tenderId, businessId);
    }
  ```

- [ ] **Step 8: Run the tests to verify they pass**

  Run: `pnpm --filter @bmp/server test tenders.service.spec.ts`
  Expected: PASS (all tests in the file, including the 4 new ones).

- [ ] **Step 9: Add the routes**

  In `apps/server/src/modules/tenders/tenders.routes.ts`, add `pinTenderNoteSchema` to the import
  from `./tenders.validation.js`:

  ```ts
  import {
    addAssigneeSchema,
    changeTenderStatusSchema,
    createCompetitorSchema,
    createTenderSchema,
    listTendersQuerySchema,
    pinTenderNoteSchema,
    setTenderTagsSchema,
    updateCompetitorSchema,
    updateTenderSchema,
    uploadTenderDocumentSchema,
  } from "./tenders.validation.js";
  ```

  Add these routes right after the competitor routes block (after the `deleteCompetitor` route,
  before the `/:id/tags` `@openapi` block):

  ```ts
    /**
     * @openapi
     * /tenders/{id}/pinned-notes:
     *   post:
     *     tags: [Tenders]
     *     summary: Pin a line from a tender's Terms & Notes
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       201: { description: Note pinned }
     */
    router.post(
      "/:id/pinned-notes",
      authenticateMiddleware,
      requirePermission("tenders:update"),
      validate(pinTenderNoteSchema),
      controller.pinNote,
    );

    /**
     * @openapi
     * /tenders/{id}/pinned-notes/{pinnedNoteId}:
     *   delete:
     *     tags: [Tenders]
     *     summary: Unpin a previously pinned line
     *     security: [{ bearerAuth: [] }]
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *       - in: path
     *         name: pinnedNoteId
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200: { description: Note unpinned }
     */
    router.delete(
      "/:id/pinned-notes/:pinnedNoteId",
      authenticateMiddleware,
      requirePermission("tenders:update"),
      controller.unpinNote,
    );
  ```

- [ ] **Step 10: Add the controller handlers**

  In `apps/server/src/modules/tenders/tenders.controller.ts`, add `PinTenderNoteBody` to the type
  import from `./tenders.validation.js`:

  ```ts
  import type {
    AddAssigneeBody,
    ChangeTenderStatusBody,
    CreateCompetitorBody,
    CreateTenderBody,
    ListTendersQueryParsed,
    PinTenderNoteBody,
    SetTenderTagsBody,
    UpdateCompetitorBody,
    UpdateTenderBody,
    UploadTenderDocumentBody,
  } from "./tenders.validation.js";
  ```

  Add these two handlers right after `deleteCompetitor`:

  ```ts
    pinNote = asyncHandler(async (req, res) => {
      const body = req.body as PinTenderNoteBody;
      const tender = await this.tendersService.pinNote(
        req.params.id!,
        body.lineText,
        req.user!.id,
        req.user!.businessId,
      );
      sendSuccess(res, tender, "Note pinned", 201);
    });

    unpinNote = asyncHandler(async (req, res) => {
      const tender = await this.tendersService.unpinNote(
        req.params.id!,
        req.params.pinnedNoteId!,
        req.user!.id,
        req.user!.businessId,
      );
      sendSuccess(res, tender, "Note unpinned");
    });
  ```

- [ ] **Step 11: Run the full server test suite and typecheck**

  Run: `pnpm --filter @bmp/server test`
  Expected: PASS.

  Run: `pnpm --filter @bmp/server typecheck`
  Expected: PASS.

- [ ] **Step 12: Commit**

  ```bash
  git add packages/types/src/tender.ts apps/server/src/modules/tenders
  git commit -m "feat(tenders): add pin/unpin routes for Terms & Notes lines"
  ```

---

## Task 3: Frontend hooks

**Files:**
- Modify: `apps/web/src/hooks/use-tenders.ts`

**Interfaces:**
- Consumes: `PinTenderNoteInput`, `TenderDto` (`@bmp/types`, from Task 2).
- Produces: `usePinTenderNote(id: string)` and `useUnpinTenderNote(id: string)` — TanStack Query
  mutation hooks, consumed by Task 6's page wiring.

No dedicated test file exists for this hooks module in this codebase (no `use-tenders.spec.ts`
precedent) — verification is a clean typecheck, matching how every other hook in this file was
added.

- [ ] **Step 1: Add `PinTenderNoteInput` to the type import**

  In `apps/web/src/hooks/use-tenders.ts`, change the top import to:

  ```ts
  import type {
    AddTenderAssigneeInput,
    ApiResponse,
    AttachmentDto,
    ChangeTenderStatusInput,
    CreateTenderCompetitorInput,
    CreateTenderInput,
    ListTendersQuery,
    PaginatedResult,
    PinTenderNoteInput,
    TenderDto,
    TenderExtractionResultDto,
    TenderListItemDto,
    TenderStatusHistoryEntryDto,
    UpdateTenderCompetitorInput,
    UpdateTenderInput,
  } from "@bmp/types";
  ```

- [ ] **Step 2: Add the two hooks**

  Add these functions right after `useDeleteTenderCompetitor`:

  ```ts
  export function usePinTenderNote(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (input: PinTenderNoteInput) => {
        const response = await apiClient.post<ApiResponse<TenderDto>>(`/tenders/${id}/pinned-notes`, input);
        return unwrap(response.data);
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
      },
    });
  }

  export function useUnpinTenderNote(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (pinnedNoteId: string) => {
        const response = await apiClient.delete<ApiResponse<TenderDto>>(
          `/tenders/${id}/pinned-notes/${pinnedNoteId}`,
        );
        return unwrap(response.data);
      },
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["tenders", id] });
      },
    });
  }
  ```

- [ ] **Step 3: Verify typecheck**

  Run: `pnpm --filter @bmp/web typecheck`

  If the web dev server is currently running, stop it first (or run this when it's idle) — running
  `typecheck` concurrently with `next dev` races on `.next/types` and produces bogus errors (see
  CLAUDE.md's documented gotcha).

  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/web/src/hooks/use-tenders.ts
  git commit -m "feat(web): add usePinTenderNote/useUnpinTenderNote hooks"
  ```

---

## Task 4: `TenderNotesView` — pin affordance per line

**Files:**
- Modify: `apps/web/src/components/tenders/tender-notes-view.tsx`

**Interfaces:**
- Produces: `TenderNotesView` gains two new optional props — `pinnedLineTexts?: Set<string>` and
  `onTogglePin?: (lineText: string) => void`. When `onTogglePin` is omitted the component renders
  exactly as it does today (no pin affordance) — this keeps the component usable read-only.
  `pendingLineText?: string | null` — when it matches a line's text, that line's control shows a
  spinner instead of the pin icon. Consumed by Task 6.

No test file exists for this component. Verify manually per Step 3.

- [ ] **Step 1: Rewrite the component**

  Replace the full contents of `apps/web/src/components/tenders/tender-notes-view.tsx`:

  ```tsx
  "use client";

  import { Loader2, Pin } from "lucide-react";
  import type { ReactNode } from "react";

  interface TenderNotesViewProps {
    notes: string;
    pinnedLineTexts?: Set<string>;
    onTogglePin?: (lineText: string) => void;
    pendingLineText?: string | null;
  }

  // Minimal renderer for the markdown-ish Terms & Notes string (## headers + "- " points).
  // Deliberately not a full markdown lib — the content is only ever headers and bullet lines.
  export function TenderNotesView({
    notes,
    pinnedLineTexts,
    onTogglePin,
    pendingLineText,
  }: TenderNotesViewProps) {
    return (
      <div className="space-y-1 text-sm">
        {notes.split("\n").map((line, index) => {
          const trimmed = line.trim();
          const key = `${index}-${trimmed.slice(0, 12)}`;
          if (!trimmed) return <div key={key} className="h-1.5" />;
          if (trimmed.startsWith("## ")) {
            return (
              <p key={key} className="mt-3 font-medium first:mt-0">
                {trimmed.slice(3)}
              </p>
            );
          }
          if (trimmed.startsWith("# ")) {
            return (
              <p key={key} className="mt-3 font-semibold first:mt-0">
                {trimmed.slice(2)}
              </p>
            );
          }
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            const lineText = trimmed.slice(2);
            return (
              <PinnableLine
                key={key}
                lineText={lineText}
                pinnedLineTexts={pinnedLineTexts}
                onTogglePin={onTogglePin}
                pendingLineText={pendingLineText}
              >
                <div className="flex gap-2 pl-1">
                  <span className="text-muted-foreground">•</span>
                  <span>{lineText}</span>
                </div>
              </PinnableLine>
            );
          }
          return (
            <PinnableLine
              key={key}
              lineText={trimmed}
              pinnedLineTexts={pinnedLineTexts}
              onTogglePin={onTogglePin}
              pendingLineText={pendingLineText}
            >
              <p className="text-muted-foreground">{trimmed}</p>
            </PinnableLine>
          );
        })}
      </div>
    );
  }

  function PinnableLine({
    lineText,
    pinnedLineTexts,
    onTogglePin,
    pendingLineText,
    children,
  }: {
    lineText: string;
    pinnedLineTexts?: Set<string>;
    onTogglePin?: (lineText: string) => void;
    pendingLineText?: string | null;
    children: ReactNode;
  }) {
    if (!onTogglePin) return <>{children}</>;

    const isPinned = pinnedLineTexts?.has(lineText) ?? false;
    const isPending = pendingLineText === lineText;

    return (
      <div className="group relative flex items-center gap-1">
        <div className="flex-1">{children}</div>
        <button
          type="button"
          onClick={() => onTogglePin(lineText)}
          disabled={isPending}
          title={isPinned ? "Click to unpin" : "Click to pin"}
          className={`shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground ${
            isPinned || isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pin className="h-3.5 w-3.5" fill={isPinned ? "currentColor" : "none"} />
          )}
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify typecheck**

  Run: `pnpm --filter @bmp/web typecheck`
  Expected: PASS. (`TenderNotesView notes={tender.notes}` at its one call site,
  `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx:297`, still compiles — the three new props
  are optional.)

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/tenders/tender-notes-view.tsx
  git commit -m "feat(web): add hover-to-pin affordance to TenderNotesView"
  ```

---

## Task 5: `PinnedTenderNotes` component

**Files:**
- Create: `apps/web/src/components/tenders/pinned-tender-notes.tsx`

**Interfaces:**
- Consumes: `TenderPinnedNoteDto` (`@bmp/types`, from Task 2).
- Produces: `PinnedTenderNotes({ pinnedNotes, onUnpin, pendingLineText }: PinnedTenderNotesProps)`,
  consumed by Task 6.

- [ ] **Step 1: Create the component**

  Create `apps/web/src/components/tenders/pinned-tender-notes.tsx`:

  ```tsx
  "use client";

  import type { TenderPinnedNoteDto } from "@bmp/types";
  import { Loader2, PinOff } from "lucide-react";

  interface PinnedTenderNotesProps {
    pinnedNotes: TenderPinnedNoteDto[];
    onUnpin?: (pinnedNote: TenderPinnedNoteDto) => void;
    pendingLineText?: string | null;
  }

  // Renders nothing when there's nothing pinned — this section only ever appears once the user
  // has pinned at least one line, matching how instructionsLine/metaLine omit themselves elsewhere
  // in this codebase's document builders.
  export function PinnedTenderNotes({ pinnedNotes, onUnpin, pendingLineText }: PinnedTenderNotesProps) {
    if (pinnedNotes.length === 0) return null;

    return (
      <div className="mb-4 space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">📌 Pinned</p>
        {pinnedNotes.map((note) => {
          const isPending = pendingLineText === note.lineText;
          return (
            <div key={note.id} className="flex items-start justify-between gap-2">
              <span>{note.lineText}</span>
              {onUnpin && (
                <button
                  type="button"
                  onClick={() => onUnpin(note)}
                  disabled={isPending}
                  title="Click to unpin"
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <PinOff className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 2: Verify typecheck**

  Run: `pnpm --filter @bmp/web typecheck`
  Expected: PASS.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/web/src/components/tenders/pinned-tender-notes.tsx
  git commit -m "feat(web): add PinnedTenderNotes component"
  ```

---

## Task 6: Wire pinning into the tender detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Consumes: `usePinTenderNote`/`useUnpinTenderNote` (Task 3), `TenderNotesView`'s new props (Task
  4), `PinnedTenderNotes` (Task 5).

- [ ] **Step 1: Add imports**

  In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, this file currently has no React import
  line at all — `useState` must be added. Matching this codebase's import-order convention (plain
  `react` sorts alphabetically within the external-packages group, after `next/navigation`, not
  grouped separately at the top — see `tender-download-menu.tsx`'s `useState` import for the exact
  precedent), change:

  ```ts
  import { Pencil, Receipt, ScrollText, Trash2 } from "lucide-react";
  import Link from "next/link";
  import { useParams, useRouter, useSearchParams } from "next/navigation";
  ```

  to:

  ```ts
  import { Pencil, Receipt, ScrollText, Trash2 } from "lucide-react";
  import Link from "next/link";
  import { useParams, useRouter, useSearchParams } from "next/navigation";
  import { useState } from "react";
  ```

  Add the `PinnedTenderNotes` import right after the `LinkedBudgetaryQuotationCard` import:

  ```ts
  import { ConvertToProjectDialog } from "@/components/projects/convert-to-project-dialog";
  import { LinkedBudgetaryQuotationCard } from "@/components/tenders/linked-budgetary-quotation-card";
  import { PinnedTenderNotes } from "@/components/tenders/pinned-tender-notes";
  import { StatusChangeDialog } from "@/components/tenders/status-change-dialog";
  ```

  Add `usePinTenderNote`/`useUnpinTenderNote` to the `use-tenders` import:

  ```ts
  import {
    useChangeTenderStatus,
    useDeleteTender,
    usePinTenderNote,
    useSetTenderTags,
    useTender,
    useUnpinTenderNote,
  } from "@/hooks/use-tenders";
  ```

- [ ] **Step 2: Add pin/unpin state and handler**

  Right after the existing `const setTags = useSetTenderTags(params.id);` line, add:

  ```ts
    const setTags = useSetTenderTags(params.id);
    const pinNote = usePinTenderNote(params.id);
    const unpinNote = useUnpinTenderNote(params.id);
    const [pendingLineText, setPendingLineText] = useState<string | null>(null);
  ```

  Right after the existing `handleDelete` function, add:

  ```ts
    async function handleTogglePin(lineText: string, pinnedNoteId?: string) {
      setPendingLineText(lineText);
      try {
        if (pinnedNoteId) {
          await unpinNote.mutateAsync(pinnedNoteId);
        } else {
          await pinNote.mutateAsync({ lineText });
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Could not update pin",
          description: error instanceof Error ? error.message : "Please try again.",
        });
      } finally {
        setPendingLineText(null);
      }
    }
  ```

- [ ] **Step 3: Render the pinned section and wire `TenderNotesView`**

  Find this block:

  ```tsx
          {tender.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Terms &amp; Notes</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <TenderNotesView notes={tender.notes} />
              </CardContent>
            </Card>
          )}
  ```

  Replace it with:

  ```tsx
          {tender.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Terms &amp; Notes</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <PinnedTenderNotes
                  pinnedNotes={tender.pinnedNotes}
                  pendingLineText={pendingLineText}
                  onUnpin={
                    canUpdate
                      ? (note) => handleTogglePin(note.lineText, note.id)
                      : undefined
                  }
                />
                <TenderNotesView
                  notes={tender.notes}
                  pinnedLineTexts={new Set(tender.pinnedNotes.map((note) => note.lineText))}
                  pendingLineText={pendingLineText}
                  onTogglePin={
                    canUpdate
                      ? (lineText) => {
                          const existing = tender.pinnedNotes.find((note) => note.lineText === lineText);
                          void handleTogglePin(lineText, existing?.id);
                        }
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          )}
  ```

- [ ] **Step 4: Verify typecheck**

  Run: `pnpm --filter @bmp/web typecheck`
  Expected: PASS.

- [ ] **Step 5: Manual verification in a dev server**

  Start `pnpm dev` (or use the already-running one). Open a tender detail page for a tender that
  has Terms & Notes text. Hover a bullet/paragraph line — a pin icon should fade in; click it — the
  line should appear under a new "📌 Pinned" section above the notes, and the same line's icon in
  the body should now show filled and stay visible without hovering. Click the pin icon again (from
  either the pinned section or the body) — it should disappear from the pinned section. Confirm `##
  `/`# ` heading lines never show a pin icon.

- [ ] **Step 6: Commit**

  ```bash
  git add "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx"
  git commit -m "feat(web): wire pin/unpin into the tender detail page"
  ```

---

## Task 7: RFQ integration — pinned notes in RFR PDF/Word

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq-document.ts`
- Modify: `apps/server/src/modules/rfq/rfq.service.ts`
- Modify: `apps/server/templates/rfr.docx`
- Test: `apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts`
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Consumes: `TenderDetail["pinnedNotes"]` (Task 2's repository include) via
  `tendersRepository.findById`, already called by `loadRfrDocumentData`.
- Produces: `RfrDocumentData.pinnedNotes: string[]`; `toRfrDocumentData(rfq, business, tenderNumber,
  pinnedNotes)` (new 4th parameter); `buildRfrPdf`/`buildRfrDocx` render an "Important Notes"
  section when `pinnedNotes.length > 0`.

- [ ] **Step 1: Write the failing `toRfrDocumentData` tests**

  In `apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts`, update the two existing
  `toRfrDocumentData` calls to pass a 4th argument and assert on it. Replace the
  `describe("toRfrDocumentData", ...)` block with:

  ```ts
  describe("toRfrDocumentData", () => {
    it("shapes business, RFQ and item data into one document payload", () => {
      const data = toRfrDocumentData(
        {
          title: "Cement Supply RFQ",
          instructions: "Deliver to site within 15 days",
          dueDate: new Date(2026, 8, 1),
          items: [
            { id: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: "ISI marked only" },
            { id: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
          ],
        },
        { name: "Archie Udyog", address: "Pune, MH", gstNumber: "27AAAAA0000A1Z5" },
        "TND-0001",
        ["Inspection required before dispatch"],
      );

      expect(data).toEqual({
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        rfqTitle: "Cement Supply RFQ",
        tenderNumber: "TND-0001",
        dueDate: "01-09-2026",
        instructions: "Deliver to site within 15 days",
        pinnedNotes: ["Inspection required before dispatch"],
        items: [
          {
            rfqItemId: "item-1",
            description: "OPC Cement",
            unit: "bag",
            quantity: 500,
            instructions: "ISI marked only",
          },
          { rfqItemId: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
        ],
      });
    });

    it("carries nulls through when there is no tender, due date or instructions, and an empty pinnedNotes", () => {
      const data = toRfrDocumentData(
        { title: "Standalone RFQ", instructions: null, dueDate: null, items: [] },
        { name: "Archie Udyog", address: null, gstNumber: null },
        null,
        [],
      );

      expect(data.tenderNumber).toBeNull();
      expect(data.dueDate).toBeNull();
      expect(data.instructions).toBeNull();
      expect(data.pinnedNotes).toEqual([]);
    });
  });
  ```

  Add `pinnedNotes: []` to every existing object literal passed to `buildRfrPdf`/`buildRfrDocx` in
  this same file (four call sites: the two in `describe("buildRfrPdf", ...)` at what are currently
  lines 104 and 149, and the two in `describe("buildRfrDocx", ...)` at what are currently lines 180
  and 218) — e.g. the first one becomes:

  ```ts
    const buffer = await buildRfrPdf({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: [],
      items: [
        {
          rfqItemId: "item-1",
          description: "OPC Cement",
          unit: "bag",
          quantity: 500,
          instructions: "ISI marked only",
        },
      ],
    });
  ```

  Apply the same one-line `pinnedNotes: [],` addition (right after `instructions:`) to the other
  three call sites, leaving everything else in each literal unchanged.

  Add two new tests at the end of `describe("buildRfrPdf", ...)`, right before its closing `});`:

  ```ts
    it("still returns a valid PDF when pinnedNotes is non-empty", async () => {
      const buffer = await buildRfrPdf({
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        rfqTitle: "Cement Supply RFQ",
        tenderNumber: "TND-0001",
        dueDate: "01-09-2026",
        instructions: "Deliver to site within 15 days",
        pinnedNotes: ["Inspection required before dispatch", "Delivery within 30 days of PO"],
        items: [
          { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
        ],
      });

      expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(buffer.length).toBeGreaterThan(500);
    });
  ```

  Add two new tests at the end of `describe("buildRfrDocx", ...)`, right before its closing `});`:

  ```ts
    it("renders an Important Notes section when pinnedNotes is non-empty", async () => {
      const buffer = await buildRfrDocx({
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        rfqTitle: "Cement Supply RFQ",
        tenderNumber: "TND-0001",
        dueDate: "01-09-2026",
        instructions: "Deliver to site within 15 days",
        pinnedNotes: ["Inspection required before dispatch", "Delivery within 30 days of PO"],
        items: [
          { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
        ],
      });

      const zip = new PizZip(buffer);
      const documentXml = zip.file("word/document.xml")!.asText();

      expect(documentXml).toContain("Important Notes");
      expect(documentXml).toContain("Inspection required before dispatch");
      expect(documentXml).toContain("Delivery within 30 days of PO");
      expect(documentXml).not.toContain("{{#pinnedNotes}}");
      expect(documentXml).not.toContain("{{/pinnedNotes}}");
      expect(documentXml).not.toContain("{{#hasPinnedNotes}}");
      expect(documentXml).not.toContain("{{/hasPinnedNotes}}");
    });

    it("omits the Important Notes heading entirely when pinnedNotes is empty", async () => {
      const buffer = await buildRfrDocx({
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        rfqTitle: "Cement Supply RFQ",
        tenderNumber: "TND-0001",
        dueDate: "01-09-2026",
        instructions: "Deliver to site within 15 days",
        pinnedNotes: [],
        items: [
          { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
        ],
      });

      const zip = new PizZip(buffer);
      const documentXml = zip.file("word/document.xml")!.asText();

      expect(documentXml).not.toContain("Important Notes");
    });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  Run: `pnpm --filter @bmp/server test rfq-document.spec.ts`
  Expected: FAIL (compile error — `toRfrDocumentData` doesn't accept a 4th argument yet,
  `pinnedNotes` isn't a valid `RfrDocumentData`/`buildRfrPdf`/`buildRfrDocx` field yet).

- [ ] **Step 3: Update `RfrDocumentData` and `toRfrDocumentData`**

  In `apps/server/src/modules/rfq/rfq-document.ts`, add `pinnedNotes` to the `RfrDocumentData`
  interface:

  ```ts
  export interface RfrDocumentData {
    businessName: string;
    businessAddress: string | null;
    businessGstNumber: string | null;
    rfqTitle: string;
    tenderNumber: string | null;
    dueDate: string | null;
    instructions: string | null;
    pinnedNotes: string[];
    items: RfrDocumentItem[];
  }
  ```

  Replace `toRfrDocumentData`:

  ```ts
  export function toRfrDocumentData(
    rfq: RfrSourceRfq,
    business: { name: string; address: string | null; gstNumber: string | null },
    tenderNumber: string | null,
    pinnedNotes: string[],
  ): RfrDocumentData {
    return {
      businessName: business.name,
      businessAddress: business.address,
      businessGstNumber: business.gstNumber,
      rfqTitle: rfq.title,
      tenderNumber,
      dueDate: rfq.dueDate ? formatDate(rfq.dueDate) : null,
      instructions: rfq.instructions,
      pinnedNotes,
      items: rfq.items.map((item) => ({
        rfqItemId: item.id,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        instructions: item.instructions,
      })),
    };
  }
  ```

- [ ] **Step 4: Render pinned notes in `buildRfrPdf`**

  In `buildRfrPdf`, find:

  ```ts
      const instructionsLine = buildInstructionsLine(data.instructions);
      if (instructionsLine) doc.fontSize(9).font("Helvetica").text(instructionsLine);
      doc.moveDown();
  ```

  Replace it with:

  ```ts
      const instructionsLine = buildInstructionsLine(data.instructions);
      if (instructionsLine) doc.fontSize(9).font("Helvetica").text(instructionsLine);
      if (data.pinnedNotes.length > 0) {
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica-Bold").text("Important Notes");
        doc.fontSize(9).font("Helvetica");
        for (const note of data.pinnedNotes) {
          doc.text(`• ${note}`);
        }
      }
      doc.moveDown();
  ```

- [ ] **Step 5: Add the `hasPinnedNotes`/`pinnedNotes` loop to `buildRfrDocx`**

  In `buildRfrDocx`, add `pinnedNotes` and a `hasPinnedNotes` presence-flag array (needed because
  Docxtemplater's `{{#array}}...{{/array}}` always *loops* an array — a second, 0-or-1-length array
  is how the "Important Notes" heading renders exactly once, only when there's at least one pinned
  line, instead of once per line):

  ```ts
  export async function buildRfrDocx(data: RfrDocumentData): Promise<Buffer> {
    const templateBuffer = await readFile(RFR_TEMPLATE_PATH);
    return fillDocxTemplate(templateBuffer, {
      businessName: data.businessName,
      addressLine: buildAddressLine(data.businessAddress, data.businessGstNumber),
      rfqTitle: data.rfqTitle,
      metaLine: buildMetaLine(data.tenderNumber, data.dueDate),
      instructionsLine: buildInstructionsLine(data.instructions),
      pinnedNotes: data.pinnedNotes,
      hasPinnedNotes: data.pinnedNotes.length > 0 ? [{}] : [],
      items: data.items.map((item) => ({
        description: item.description,
        unit: item.unit ?? "",
        quantity: String(item.quantity),
        instructions: item.instructions ?? "",
      })),
    });
  }
  ```

- [ ] **Step 6: Edit `apps/server/templates/rfr.docx`'s raw XML**

  This is a binary `.docx` (a zip of XML parts) — edit it by unzipping, patching
  `word/document.xml` as text, and re-zipping, rather than through a word processor. `pizzip` is a
  dependency of `apps/server`, not hoisted to the repo root — run this script with `apps/server` as
  the working directory (not the repo root) so plain `node` can resolve the `pizzip` import:

  ```bash
  cd apps/server && node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import PizZip from "pizzip";

  const path = "templates/rfr.docx";
  const zip = new PizZip(readFileSync(path));
  const xml = zip.file("word/document.xml").asText();

  const marker = "{{instructionsLine}}</w:t></w:r></w:p>";
  const idx = xml.indexOf(marker);
  if (idx === -1) throw new Error("marker not found — template structure changed");
  const insertAt = idx + marker.length;

  const insertion =
    "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">{{#hasPinnedNotes}}Important Notes:</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t xml:space=\"preserve\">{{#pinnedNotes}}{{.}}{{/pinnedNotes}}</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t xml:space=\"preserve\">{{/hasPinnedNotes}}</w:t></w:r></w:p>";

  const newXml = xml.slice(0, insertAt) + insertion + xml.slice(insertAt);
  zip.file("word/document.xml", newXml);
  writeFileSync(path, zip.generate({ type: "nodebuffer" }));
  console.log("patched", path);
  '
  ```

  This inserts three new paragraphs immediately after the existing `{{instructionsLine}}`
  paragraph and before the pre-table blank paragraph:
  - A bold heading paragraph opening `{{#hasPinnedNotes}}` with the literal text
    "Important Notes:".
  - A paragraph containing `{{#pinnedNotes}}{{.}}{{/pinnedNotes}}` — because this loop's start and
    end tags sit inside the *same* paragraph, and `fillDocxTemplate` sets `paragraphLoop: true`,
    Docxtemplater repeats this whole paragraph once per pinned line (one line per paragraph), not
    once per line within a single paragraph.
  - A closing paragraph containing only `{{/hasPinnedNotes}}`.

  **Correction (found by the final whole-branch review, commit `242712d`):** the claim above is
  wrong. `paragraphLoop` only expands to per-paragraph repetition when `{{#tag}}`/`{{/tag}}` are
  each the *sole* content of their *own* paragraph — with both tags and `{{.}}` sharing one
  paragraph as shown here, Docxtemplater does an inline loop instead and concatenates every pinned
  note into one run with no separator. The shipped template instead puts `{{#pinnedNotes}}` alone
  in its own paragraph, `• {{.}}` in a middle paragraph (repeated once per note, with a `• `
  prefix matching the PDF's bullet style), and folds `{{/hasPinnedNotes}}`/`{{/pinnedNotes}}` into
  the end without a trailing stray blank paragraph. See `rfq-document.spec.ts`'s
  `"renders an Important Notes section..."` test for the exact expected shape.

  Since `hasPinnedNotes` is `[{}]` (length 1) when there are pinned notes and `[]` when there
  aren't, the entire three-paragraph block — heading included — renders exactly once when there's
  at least one pinned note, and vanishes completely otherwise.

- [ ] **Step 7: Run the rfq-document tests to verify they pass**

  Run: `pnpm --filter @bmp/server test rfq-document.spec.ts`
  Expected: PASS (all tests, including the 4 new/updated ones).

- [ ] **Step 8: Wire `loadRfrDocumentData` to pass pinned notes through**

  In `apps/server/src/modules/rfq/rfq.service.ts`, replace `loadRfrDocumentData`:

  ```ts
    private async loadRfrDocumentData(rfqId: string, businessId: string) {
      const rfq = await this.getDetailOrThrow(rfqId, businessId);
      const business = await this.businessesRepository.findById(businessId);
      if (!business) throw new NotFoundError("Business not found");

      let tenderNumber: string | null = null;
      let pinnedNotes: string[] = [];
      if (rfq.tenderId) {
        const tender = await this.tendersRepository.findById(rfq.tenderId, businessId);
        tenderNumber = tender?.tenderNumber ?? null;
        pinnedNotes = tender?.pinnedNotes.map((note) => note.lineText) ?? [];
      }

      const data = toRfrDocumentData(rfq, business, tenderNumber, pinnedNotes);
      const safeTitle = rfq.title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60);
      return { data, safeTitle };
    }
  ```

- [ ] **Step 9: Write the failing service-level test**

  In `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`, extend `FakeTendersRepository` to
  carry pinned notes:

  ```ts
  class FakeTendersRepository implements Partial<ITendersRepository> {
    tenderIds = new Set<string>();
    tenderNumbers = new Map<string, string>();
    pinnedNotesByTenderId = new Map<string, string[]>();

    async findById(id: string, _businessId: string) {
      if (!this.tenderIds.has(id)) return null;
      const lines = this.pinnedNotesByTenderId.get(id) ?? [];
      return {
        id,
        tenderNumber: this.tenderNumbers.get(id) ?? "TND-0000",
        pinnedNotes: lines.map((lineText, index) => ({ id: `pin-${index}`, lineText })),
      } as never;
    }
  }
  ```

  Add this test right after `it("builds a PDF request-for-rates document for an existing RFQ", ...)`:

  ```ts
    it("includes the linked tender's pinned notes in the generated RFR Word document", async () => {
      businessesRepository.businesses.set(businessId, { name: "Archie Udyog", address: null, gstNumber: null });
      const tenderId = randomUUID();
      tendersRepository.tenderIds.add(tenderId);
      tendersRepository.pinnedNotesByTenderId.set(tenderId, ["Inspection required before dispatch"]);

      const rfq = await service.create(
        { title: "Cement Supply RFQ", tenderId, items: [{ description: "OPC Cement", quantity: 500 }] },
        actorId,
        { businessId },
      );

      const { buffer } = await service.buildRfrDocxFor(rfq.id, businessId);
      const zip = new PizZip(buffer);
      const documentXml = zip.file("word/document.xml")!.asText();

      expect(documentXml).toContain("Inspection required before dispatch");
    });
  ```

  Add `PizZip` to this test file's imports at the top (alphabetically, among the existing external
  package imports):

  ```ts
  import PizZip from "pizzip";
  ```

- [ ] **Step 10: Run the tests to verify they fail, then pass**

  Run: `pnpm --filter @bmp/server test rfq.service.spec.ts`
  Expected: first FAIL (new test references pinned notes that don't flow through yet — actually,
  since Step 8 already wired `loadRfrDocumentData`, this test should already pass once the fake
  repository change compiles; if it fails, the fake's `findById` return shape doesn't match what
  `loadRfrDocumentData` expects — check `tender?.pinnedNotes.map(...)` against the fake's shape).
  Then PASS after any fixes.

- [ ] **Step 11: Run the full server suite and typecheck**

  Run: `pnpm --filter @bmp/server test`
  Expected: PASS.

  Run: `pnpm --filter @bmp/server typecheck`
  Expected: PASS.

- [ ] **Step 12: Commit**

  ```bash
  git add apps/server/src/modules/rfq apps/server/templates/rfr.docx
  git commit -m "feat(rfq): carry a tender's pinned notes into RFR PDF/Word documents"
  ```
