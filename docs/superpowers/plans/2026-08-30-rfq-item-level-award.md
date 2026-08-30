# RFQ Item-Level Award & Historical Vendor Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace whole-RFQ single-vendor award with per-item quote selection, make Purchase Order creation from an RFQ group items by vendor into one PO per vendor, extend `HistoricalRate` to record which vendor won each item, and move RFQ creation/send actions off the tender's BOQ grid onto the RFQ's own pages.

**Architecture:** `RfqQuote` gains an `isSelected` flag (same transactional single-flag-at-a-time pattern this codebase already uses for `isCurrent` on Attachments/BOQ versions). `Rfq.awardedVendorId` and the `AWARDED` status are removed — "awarded" becomes a derived fact (does every item have a selected quote), not stored state. Purchase Order creation groups `RfqItem`s by their selected quote's vendor and creates one PO per group. `HistoricalRate` gains `vendorId`/`rfqQuoteId`/`isDefault` so pushing a closed RFQ's rates to its tender also records who won each item.

**Tech Stack:** Prisma/PostgreSQL, Express/TypeScript, Next.js/React, Vitest, hand-written fake repositories (no mocking framework).

**Spec:** `docs/superpowers/specs/2026-08-30-rfq-item-level-award-design.md`

## Global Constraints

- Every `isSelected`/`isDefault` flip is transactional: unset any prior flag before setting the new one, in the same `prisma.$transaction`, mirroring the existing Attachment/BOQ `isCurrent` convention — never a bare two-step update.
- The relocated "send RFQ to a vendor" action (backend endpoint and its frontend button) stays gated behind `rfq:create`, **not** `rfq:update`. This preserves an explicit existing design decision (`packages/types/src/rbac.ts`'s comment on `TENDER_MANAGER_PERMISSIONS`): Tender Manager has `rfq:create` but not `rfq:update`, specifically so they can send RFQs without a Purchase Manager account. Gating the relocated button behind `rfq:update` would silently take this away from them.
- `RfqQuote.isSelected` auto-selection rule: whenever `upsertQuote` writes a quote and the item has no selected quote yet, auto-select the lowest non-regretted, non-null-rate quote for that item. Once any quote for an item is `isSelected`, auto-selection never fires again for that item — an explicit human choice (including the API's `selectQuote`) always wins over a later cheaper quote.
- `pushRatesToTender` requires `rfq.status === "CLOSED"`. `createFromRfq` requires the same (replacing today's `"AWARDED"` check) — both enforced server-side, not just by frontend button visibility.
- `HistoricalRate` rows written by `pushRatesToTender` always use `category: "MATERIAL"` — there is no existing category-inference logic anywhere in the codebase to reuse (verified: `category` is 100% user-supplied on the one existing creation path, `rates.controller.ts#create`), and BOQ items have no field that maps to `HistoricalRateCategory`'s four values. This is a deliberate, documented simplification — a human can still correct any row's category via the existing historical-rates UI.
- Every task that touches `apps/server` runs `pnpm --filter @bmp/server typecheck` and its own test file before committing. Every task that touches `apps/web` runs `pnpm --filter @bmp/web typecheck` before committing.

---

### Task 1: Schema migration — `RfqQuote.isSelected`, drop whole-RFQ award, extend `HistoricalRate`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_rfq_item_level_award/migration.sql`

**Interfaces:**
- Produces: `RfqQuote.isSelected: boolean`, `HistoricalRate.vendorId: string | null`, `HistoricalRate.rfqQuoteId: string | null`, `HistoricalRate.isDefault: boolean`. Removes `Rfq.awardedVendorId`, `Rfq.awardedVendor` relation, `Vendor.awardedRfqs` back-relation, `"AWARDED"` from `RfqStatus`.

- [ ] **Step 1: Edit `schema.prisma`**

In the `RfqQuote` model, add one field at the end (before the closing brace, after `updatedAt`):

```prisma
  isSelected Boolean @default(false)
```

In the `Rfq` model, delete these two lines entirely:

```prisma
  awardedVendorId String?
  awardedVendor   Vendor? @relation("RfqAwardedVendor", fields: [awardedVendorId], references: [id], onDelete: SetNull)
```

In the `RfqStatus` enum, delete the `AWARDED` line:

```prisma
enum RfqStatus {
  DRAFT
  SENT
  CLOSED
  CANCELLED
}
```

In the `Vendor` model, delete this line:

```prisma
  awardedRfqs    Rfq[]           @relation("RfqAwardedVendor")
```

and add, in its place (keeping the model's existing field grouping):

```prisma
  historicalRates HistoricalRate[]
```

In the `HistoricalRate` model, add these fields after `notes` and before the `embedding` block:

```prisma
  vendorId   String?
  vendor     Vendor?   @relation(fields: [vendorId], references: [id], onDelete: SetNull)
  rfqQuoteId String?   @unique
  rfqQuote   RfqQuote? @relation(fields: [rfqQuoteId], references: [id], onDelete: SetNull)
  isDefault  Boolean   @default(false)
```

In the `RfqQuote` model, add the reverse relation (Prisma requires it for the one-to-one above):

```prisma
  historicalRate HistoricalRate?
```

- [ ] **Step 2: Generate a migration scaffold without applying it**

```bash
pnpm --filter @bmp/database exec prisma migrate dev --create-only --name rfq_item_level_award
```

This will hit the interactive drift-prompt trap this repo's CLAUDE.md already documents for `Unsupported("vector(N)")` columns (the existing HNSW indexes aren't representable in Prisma's schema DSL). **Cancel that prompt** (Ctrl-C) if it appears — do not accept any proposed corrective migration. The `--create-only` flag should generate the new migration's SQL file without needing to resolve the drift; if it still blocks, use `prisma migrate diff` instead to produce the raw SQL:

```bash
pnpm --filter @bmp/database exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/rfq-migration-draft.sql
```

Either way, the goal is a draft SQL file to hand-edit in the next step — do not run `migrate dev` without `--create-only`, and do not accept any auto-offered corrective migration.

- [ ] **Step 3: Hand-edit the migration SQL to add a data-migration step BEFORE the enum/column changes**

Postgres cannot drop an enum value while any row still uses it — the generated migration will try to recreate the `RfqStatus` type without `AWARDED` and cast existing columns to it, which fails if any `Rfq` row currently has `status = 'AWARDED'`. Open the generated migration file and insert this block as the **first** statement, before any `ALTER TYPE`/`DROP COLUMN` on `rfqs` or `rfq_quotes`:

```sql
-- Data migration: preserve today's whole-RFQ awards as per-item selections
-- before AWARDED stops being a valid status. For every RFQ currently
-- AWARDED, mark its awarded vendor's quote as selected on every item that
-- vendor quoted (non-regretted, non-null rate), then move the RFQ to CLOSED.
UPDATE rfq_quotes rq
SET "isSelected" = true
FROM rfqs r, rfq_items ri
WHERE r.status = 'AWARDED'
  AND r."awardedVendorId" IS NOT NULL
  AND ri."rfqId" = r.id
  AND rq."rfqItemId" = ri.id
  AND rq."vendorId" = r."awardedVendorId"
  AND rq.regretted = false
  AND rq.rate IS NOT NULL;

UPDATE rfqs SET status = 'CLOSED' WHERE status = 'AWARDED';
```

Note: `"isSelected"` won't exist as a column yet at the point this UPDATE runs unless the `ALTER TABLE rfq_quotes ADD COLUMN "isSelected"` statement is moved before it too — reorder the generated migration so the file executes in this order: (1) `ALTER TABLE rfq_quotes ADD COLUMN "isSelected" BOOLEAN NOT NULL DEFAULT false`, (2) the two `UPDATE` statements above, (3) the `AWARDED`-removal enum recreation, (4) `ALTER TABLE rfqs DROP COLUMN "awardedVendorId"`, (5) the new `HistoricalRate` columns (order among themselves doesn't matter, they're all-new nullable columns).

- [ ] **Step 4: Insert a pre-migration AWARDED fixture to prove the data migration works**

Before applying the migration, seed a synthetic AWARDED RFQ using the schema as it exists right now (pre-migration, `awardedVendorId` and `AWARDED` still present):

```bash
docker compose exec -T postgres psql -U bmp -d bmp -c "
INSERT INTO businesses (id, name, code) VALUES ('11111111-1111-1111-1111-111111111111', 'Migration Fixture Business', 'MIGFIX') ON CONFLICT DO NOTHING;
INSERT INTO users (id, email, \"firstName\", \"lastName\", \"passwordHash\", \"isEmailVerified\") VALUES ('22222222-2222-2222-2222-222222222222', 'migration-fixture@example.com', 'Fixture', 'User', 'not-a-real-hash', true) ON CONFLICT DO NOTHING;
INSERT INTO vendors (id, name, category, \"createdById\") VALUES ('33333333-3333-3333-3333-333333333333', 'Migration Fixture Vendor', 'MATERIAL_SUPPLIER', '22222222-2222-2222-2222-222222222222') ON CONFLICT DO NOTHING;
INSERT INTO rfqs (id, \"businessId\", title, status, \"awardedVendorId\", \"createdById\") VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Migration Fixture RFQ', 'AWARDED', '33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222') ON CONFLICT DO NOTHING;
INSERT INTO rfq_items (id, \"rfqId\", description, quantity) VALUES ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 'Fixture Item', 10) ON CONFLICT DO NOTHING;
INSERT INTO rfq_quotes (id, \"rfqItemId\", \"vendorId\", rate, regretted) VALUES ('66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 100, false) ON CONFLICT DO NOTHING;
"
```

- [ ] **Step 5: Apply the migration and regenerate the client**

```bash
pnpm --filter @bmp/database exec prisma migrate deploy
pnpm db:generate
```

Verify no interactive prompt appeared and the migration is recorded:

```bash
pnpm --filter @bmp/database exec prisma migrate status
```

- [ ] **Step 6: Verify the fixture migrated correctly, then remove it**

```bash
docker compose exec -T postgres psql -U bmp -d bmp -t -c "select status from rfqs where id = '44444444-4444-4444-4444-444444444444';"
docker compose exec -T postgres psql -U bmp -d bmp -t -c "select \"isSelected\" from rfq_quotes where id = '66666666-6666-6666-6666-666666666666';"
```

Expected: `CLOSED` and `t` respectively — proving the exact data-migration path the spec's "Testing considerations" section calls out (a pre-migration `AWARDED` RFQ ends up `CLOSED` with its awarded vendor's quote marked selected). Then clean up the fixture:

```bash
docker compose exec -T postgres psql -U bmp -d bmp -c "
DELETE FROM rfq_quotes WHERE id = '66666666-6666-6666-6666-666666666666';
DELETE FROM rfq_items WHERE id = '55555555-5555-5555-5555-555555555555';
DELETE FROM rfqs WHERE id = '44444444-4444-4444-4444-444444444444';
DELETE FROM vendors WHERE id = '33333333-3333-3333-3333-333333333333';
DELETE FROM users WHERE id = '22222222-2222-2222-2222-222222222222';
DELETE FROM businesses WHERE id = '11111111-1111-1111-1111-111111111111';
"
```

Also confirm no other pre-existing AWARDED rows slipped through:

```bash
docker compose exec -T postgres psql -U bmp -d bmp -t -c "select count(*) from rfqs where status = 'AWARDED';"
```

Expected: `0` (or the query itself fails because the enum value no longer exists — either outcome confirms success).

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat(database): add RfqQuote.isSelected, drop whole-RFQ award, extend HistoricalRate with vendor"
```

---

### Task 2: Update `@bmp/types` for the new RFQ/HistoricalRate shapes

**Files:**
- Modify: `packages/types/src/rfq.ts`
- Modify: `packages/types/src/rates.ts` (if `HistoricalRateDto` lives there — locate it first; it may be in `packages/types/src/rates.ts` or inline near the rates controller's DTOs)

**Interfaces:**
- Consumes: nothing new (pure type changes).
- Produces: `RfqQuoteDto.isSelected: boolean`; `RfqListItemDto`/`RfqDto` without `awardedVendorId`; `RFQ_STATUSES` without `"AWARDED"`; `SelectQuoteInput { quoteId: string }`; `InviteVendorPreviewInput { vendorId: string }`; `InviteVendorInput { vendorId: string; text: string }` (both without `tenderId`/`boqItemIds` — the RFQ is now identified by URL param, not body). `HistoricalRateDto` gains `vendorId: string | null` and `isDefault: boolean`.

- [ ] **Step 1: Edit `packages/types/src/rfq.ts`**

Change `RFQ_STATUSES`:

```ts
export const RFQ_STATUSES = ["DRAFT", "SENT", "CLOSED", "CANCELLED"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];
```

Add `id` and `isSelected` to `RfqQuoteDto` (`id` is new — today's DTO has no id field at all, but the frontend's per-item select control (Task 14/15) needs a stable identifier to tell `selectQuote` which quote was clicked):

```ts
export interface RfqQuoteDto {
  id: string;
  vendorId: string;
  rate: number | null;
  regretted: boolean;
  make: string;
  model: string;
  quotedAt: string;
  remarks: string | null;
  updatedAt: string;
  isSelected: boolean;
}
```

Remove `awardedVendorId` from `RfqListItemDto` (it also appears via inheritance in `RfqDto`, so removing it here removes it from both):

```ts
export interface RfqListItemDto {
  id: string;
  title: string;
  tenderId: string | null;
  status: RfqStatus;
  dueDate: string | null;
  itemCount: number;
  vendorCount: number;
  createdAt: string;
}
```

Delete `AwardRfqInput` entirely. Add in its place:

```ts
export interface SelectQuoteInput {
  quoteId: string;
}
```

Replace the quick-send input types with:

```ts
export interface InviteVendorPreviewInput {
  vendorId: string;
}

export interface InviteVendorPreviewDto {
  text: string;
  vendorContactEmail: string;
}

export interface InviteVendorInput extends InviteVendorPreviewInput {
  text: string;
}
```

(Delete the old `QuickSendRfqPreviewInput`, `QuickSendRfqPreviewDto`, `QuickSendRfqInput` — grep the file for every remaining reference to confirm none are left unexported.)

- [ ] **Step 2: Find and edit the `HistoricalRateDto` type**

```bash
grep -rn "interface HistoricalRateDto" packages/types/src/
```

Add two fields to whatever file it's found in:

```ts
export interface HistoricalRateDto {
  // ...existing fields...
  vendorId: string | null;
  isDefault: boolean;
}
```

- [ ] **Step 3: Typecheck the types package and every consumer**

```bash
pnpm --filter @bmp/types typecheck
pnpm --filter @bmp/server typecheck
pnpm --filter @bmp/web typecheck
```

This step is expected to show errors in `rfq.service.ts`, `rfq.mapper.ts`, `rfq.controller.ts`, `purchase-orders.service.ts`, `rates.mapper.ts` (or wherever `HistoricalRateDto` is built), and several `apps/web` files — that's correct, later tasks fix each. Just confirm the errors are exactly in the files this plan's remaining tasks will touch, with no surprises elsewhere.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/rfq.ts packages/types/src/rates.ts
git commit -m "feat(types): drop whole-RFQ award types, add per-item selection and vendor-rate types"
```

---

### Task 3: RFQ repository — `selectQuote`, drop `setAwardedVendor`

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.repository.ts`
- Test: `apps/server/src/modules/rfq/__tests__/rfq.repository.integration.spec.ts` (create if it doesn't exist; check first — this module's repository tests may currently live only inside the service spec's fake, with real repository behavior covered elsewhere. If no integration spec file exists for this repository today, add one covering just this new method, matching the pattern in `apps/server/src/modules/rates/__tests__/rates-ann.integration.spec.ts` for structure.)

**Interfaces:**
- Consumes: `RfqDetail` type (unchanged shape plus `isSelected` flowing through automatically per Task 2).
- Produces: `selectQuote(rfqItemId: string, quoteId: string): Promise<void>` on `IRfqRepository`.

- [ ] **Step 1: Check for an existing repository integration test file**

```bash
ls apps/server/src/modules/rfq/__tests__/
```

If `rfq.repository.integration.spec.ts` doesn't exist, create it with this header (matching this codebase's integration-test convention: real Postgres, real app, `.env.test`):

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RfqRepository } from "../rfq.repository.js";

describe("RfqRepository (integration)", () => {
  let repository: RfqRepository;
  let businessId: string;
  let userId: string;
  let vendorAId: string;
  let vendorBId: string;
  let rfqId: string;
  let rfqItemId: string;
  let quoteAId: string;
  let quoteBId: string;

  beforeAll(async () => {
    repository = new RfqRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Rfq Repo Test ${randomUUID()}`, code: `RRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `rfq-repo-test-${randomUUID()}@example.com`,
        firstName: "Repo",
        lastName: "Test",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
    const vendorA = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Vendor A", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorAId = vendorA.id;
    const vendorB = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Vendor B", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorBId = vendorB.id;
    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId, title: "Test RFQ", createdById: userId },
    });
    rfqId = rfq.id;
    const item = await prisma.rfqItem.create({
      data: { id: randomUUID(), rfqId, description: "Cement", quantity: 100 },
    });
    rfqItemId = item.id;
    const quoteA = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId, vendorId: vendorAId, rate: 400 },
    });
    quoteAId = quoteA.id;
    const quoteB = await prisma.rfqQuote.create({
      data: { id: randomUUID(), rfqItemId, vendorId: vendorBId, rate: 380, isSelected: true },
    });
    quoteBId = quoteB.id;
  });

  afterAll(async () => {
    if (businessId) await prisma.rfq.deleteMany({ where: { businessId } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendorAId, vendorBId] } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("selecting a new quote unselects the previously-selected one for the same item", async () => {
    await repository.selectQuote(rfqItemId, quoteAId);

    const quoteA = await prisma.rfqQuote.findUniqueOrThrow({ where: { id: quoteAId } });
    const quoteB = await prisma.rfqQuote.findUniqueOrThrow({ where: { id: quoteBId } });
    expect(quoteA.isSelected).toBe(true);
    expect(quoteB.isSelected).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails (method doesn't exist yet)**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.repository.integration.spec.ts
```

Expected: `TypeError: repository.selectQuote is not a function`.

- [ ] **Step 3: Add `selectQuote` to `IRfqRepository` and `RfqRepository`, remove `setAwardedVendor`**

In `apps/server/src/modules/rfq/rfq.repository.ts`, find the `IRfqRepository` interface and:
- Delete the `setAwardedVendor(id: string, vendorId: string): Promise<void>;` line.
- Add: `selectQuote(rfqItemId: string, quoteId: string): Promise<void>;`

In the `RfqRepository` class implementation, delete the `setAwardedVendor` method body and replace it with:

```ts
  async selectQuote(rfqItemId: string, quoteId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.rfqQuote.updateMany({
        where: { rfqItemId, isSelected: true },
        data: { isSelected: false },
      }),
      this.prisma.rfqQuote.update({
        where: { id: quoteId },
        data: { isSelected: true },
      }),
    ]);
  }
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.repository.integration.spec.ts
```

- [ ] **Step 5: Update the `FakeRfqRepository` in `rfq.service.spec.ts`**

In `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`, delete the fake's `setAwardedVendor` method (lines ~84-88) and add:

```ts
  async selectQuote(rfqItemId: string, quoteId: string) {
    for (const rfq of this.rfqs.values()) {
      const item = rfq.items.find((i) => i.id === rfqItemId);
      if (!item) continue;
      for (const quote of item.quotes as { id: string; isSelected: boolean }[]) {
        quote.isSelected = quote.id === quoteId;
      }
    }
  }
```

Also update the `create()` method's item-building block to include `isSelected: false` on each pushed quote shape where quotes are constructed (there are none at creation time — `quotes: []` — so no change needed there), and update `upsertQuote`'s two quote-shape builders (the `Object.assign` branch and the `push` branch) to include `isSelected: false` as an initial default in the `push` branch only (the `Object.assign` branch updates an existing quote and must not reset its `isSelected`):

```ts
        (item.quotes as unknown[]).push({
          id: randomUUID(),
          rfqItemId,
          vendorId,
          vendor: { id: vendorId, name: vendorName },
          rate: data.rate,
          regretted: data.regretted,
          make: data.make ?? "Unbranded",
          model: data.model ?? "Generic",
          quotedAt: data.quotedAt ?? new Date(),
          remarks: data.remarks ?? null,
          updatedAt: new Date(),
          isSelected: false,
        });
```

- [ ] **Step 6: Run the full RFQ service spec to confirm nothing else broke**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
```

Expected: failures in the `award`/`reopen`/`quickSend` tests (Task 4 fixes those) — everything else passes.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.repository.ts apps/server/src/modules/rfq/__tests__/
git commit -m "feat(rfq): add repository-level per-item quote selection"
```

---

### Task 4: RFQ service — remove `award`, add `selectQuote` + auto-select-lowest, retarget `quickSend` to `inviteVendor`

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts`
- Modify: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Consumes: `selectQuote` from Task 3, `SelectQuoteInput`/`InviteVendorInput`/`InviteVendorPreviewInput` from Task 2.
- Produces: `RfqService#selectQuote(rfqId, rfqItemId, quoteId, actorId, businessId): Promise<RfqDto>`; `RfqService#inviteVendor(rfqId, input: { vendorId: string; text: string }, actorId, context): Promise<RfqDto>`; `RfqService#previewInviteVendor(rfqId, input: { vendorId: string }, businessId): Promise<InviteVendorPreviewDto>`. `upsertQuote` gains the auto-select-lowest side effect.

- [ ] **Step 1: Write the failing tests**

In `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`, delete the two `award`-describing `it()` blocks (lines ~458-472: "awards the RFQ to an invited vendor..." and "rejects awarding to a vendor that was never invited") and replace with:

```ts
  it("selects a quote for an item and unselects any prior selection for that item", async () => {
    const rfq = await createBasicRfq();
    await repository.addVendorInvite(rfq.id, vendorA);
    await repository.addVendorInvite(rfq.id, vendorB);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);
    await service.upsertQuote(itemId, vendorB, { rate: 380, regretted: false }, actorId, businessId);

    const afterAutoSelect = await service.getById(rfq.id, businessId);
    const vendorBQuote = afterAutoSelect.items[0]!.quotes.find((q) => q.vendorId === vendorB)!;
    expect(vendorBQuote.isSelected).toBe(true); // lowest (380) auto-selected

    await service.selectQuote(
      rfq.id,
      itemId,
      afterAutoSelect.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.vendorId, // placeholder, replaced below
      actorId,
      businessId,
    );
  });

  it("does not override an explicit selection when a cheaper quote arrives later", async () => {
    const rfq = await createBasicRfq();
    await repository.addVendorInvite(rfq.id, vendorA);
    await repository.addVendorInvite(rfq.id, vendorB);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);
    // Only one quote exists — vendorA gets auto-selected.
    let current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);

    // A cheaper quote arrives — must NOT silently steal the selection.
    await service.upsertQuote(itemId, vendorB, { rate: 350, regretted: false }, actorId, businessId);
    current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!.isSelected).toBe(false);
  });
```

(The first test above references a quote id awkwardly before it's fetched — fix this in the same edit by restructuring to fetch quote ids first. Write it as:)

```ts
  it("selects a specific quote for an item, unselecting any prior selection", async () => {
    const rfq = await createBasicRfq();
    await repository.addVendorInvite(rfq.id, vendorA);
    await repository.addVendorInvite(rfq.id, vendorB);
    const itemId = rfq.items[0]!.id;
    await service.upsertQuote(itemId, vendorA, { rate: 400, regretted: false }, actorId, businessId);
    await service.upsertQuote(itemId, vendorB, { rate: 380, regretted: false }, actorId, businessId);

    let current = await service.getById(rfq.id, businessId);
    const quoteA = current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!;
    const quoteB = current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!;
    expect(quoteB.isSelected).toBe(true); // auto-selected as lowest

    // repository fake keys quotes by vendorId, not a separate id — selectQuote takes the
    // quote's own id, which the fake generates; fetch it via the raw map.
    const rawItem = repository.rfqs.get(rfq.id)!.items[0]!;
    const rawQuoteA = (rawItem.quotes as { id: string; vendorId: string }[]).find((q) => q.vendorId === vendorA)!;

    await service.selectQuote(rfq.id, itemId, rawQuoteA.id, actorId, businessId);

    current = await service.getById(rfq.id, businessId);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorA)!.isSelected).toBe(true);
    expect(current.items[0]!.quotes.find((q) => q.vendorId === vendorB)!.isSelected).toBe(false);
  });
```

Rename the `quickSend` describe block's tests to match the new method name (find `describe("quickSend"` around line 672 and the three `it()`s inside it at lines 677/701/716):

```ts
    describe("inviteVendor", () => {
      it("invites the vendor to the existing RFQ and emails them", async () => {
        const rfq = await createBasicRfq();
        const invited = await service.inviteVendor(
          rfq.id,
          { vendorId: vendorA, text: "Please quote" },
          actorId,
          { businessId },
        );
        expect(invited.vendorInvites).toHaveLength(1);
        expect(invited.vendorInvites[0]!.vendor.id).toBe(vendorA);
        expect(emailService.queueRfqEmail).toHaveBeenCalledWith(
          expect.objectContaining({ bodyText: "Please quote" }),
        );
      });

      it("rejects a vendor with no contact email on file", async () => {
        const rfq = await createBasicRfq();
        vendorsRepository.vendors.set(vendorA, { id: vendorA, name: "No Email Co", contacts: [] });
        await expect(
          service.inviteVendor(rfq.id, { vendorId: vendorA, text: "Body" }, actorId, { businessId }),
        ).rejects.toThrow(BadRequestError);
      });
    });
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
```

Expected: `service.selectQuote is not a function`, `service.inviteVendor is not a function`.

- [ ] **Step 3: Implement in `rfq.service.ts`**

Change the `FINALIZED_STATUSES` literal (line 39):

```ts
const FINALIZED_STATUSES = new Set(["CLOSED", "CANCELLED"]);
```

Delete the entire `award()` method (lines ~395-411).

Add, in its place:

```ts
  async selectQuote(
    rfqId: string,
    rfqItemId: string,
    quoteId: string,
    actorId: string,
    businessId: string,
  ): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const item = rfq.items.find((i) => i.id === rfqItemId);
    if (!item) throw new BadRequestError("Item does not belong to this RFQ");
    const quote = item.quotes.find((q) => q.id === quoteId);
    if (!quote) throw new BadRequestError("Quote does not belong to this item");

    await this.rfqRepository.selectQuote(rfqItemId, quoteId);
    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTE_SELECTED",
      entityType: "RfqItem",
      entityId: rfqItemId,
      metadata: { quoteId },
    });
    return this.getById(rfqId, businessId);
  }
```

Find `upsertQuote` and add the auto-select-lowest side effect right after the existing upsert call succeeds, before returning:

```ts
    await this.rfqRepository.upsertQuote(rfqItemId, vendorId, data);

    // Auto-select the lowest non-regretted quote only while nothing has been
    // explicitly selected yet for this item — an explicit human choice
    // (via selectQuote) always wins over a later, cheaper quote.
    const rfq = await this.rfqRepository.findRfqByItemId(rfqItemId, businessId);
    const item = rfq?.items.find((i) => i.id === rfqItemId);
    if (item && !item.quotes.some((q) => q.isSelected)) {
      const cheapest = item.quotes
        .filter((q) => !q.regretted && q.rate !== null)
        .sort((a, b) => a.rate! - b.rate!)[0];
      if (cheapest) await this.rfqRepository.selectQuote(rfqItemId, cheapest.id);
    }
```

(This introduces a new repository method `findRfqByItemId` — add it to `IRfqRepository`/`RfqRepository` in Task 3's file as a thin wrapper: `findFirst` on `Rfq` where `items.some(item => item.id === rfqItemId)`, scoped by `businessId`, using the same `rfqDetailArgs` include shape. Since Task 3 is already merged by the time this task runs, add this method here instead as a small addendum to `rfq.repository.ts`, with its own one-line fake-repository update in `rfq.service.spec.ts`'s `FakeRfqRepository`: `async findRfqByItemId(itemId: string, _businessId: string) { for (const rfq of this.rfqs.values()) { if (rfq.items.some((i) => i.id === itemId)) return rfq; } return null; }`.)

Rename `quickSend`/`previewQuickSend` to `inviteVendor`/`previewInviteVendor`, changing their signatures to take an existing `rfqId` instead of `tenderId`/`boqItemIds`:

```ts
  private async loadInviteVendorContext(rfqId: string, vendorId: string, businessId: string) {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new BadRequestError("Vendor not found");
    const contact = this.pickPrimaryContact(vendor);
    if (!contact?.email) {
      throw new BadRequestError("This vendor has no contact email on file — add one first");
    }
    return { rfq, vendor, contact };
  }

  async previewInviteVendor(
    rfqId: string,
    input: { vendorId: string },
    businessId: string,
  ): Promise<InviteVendorPreviewDto> {
    const { rfq, contact } = await this.loadInviteVendorContext(rfqId, input.vendorId, businessId);
    const text = `You are invited to quote for RFQ "${rfq.title}"${
      rfq.tenderId ? " (tender-linked)" : ""
    }. Please review the attached item list and respond with your best rates.`;
    return { text, vendorContactEmail: contact.email! };
  }

  async inviteVendor(
    rfqId: string,
    input: { vendorId: string; text: string },
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<RfqDto> {
    const { contact } = await this.loadInviteVendorContext(rfqId, input.vendorId, context.businessId);

    const alreadyInvited = await this.rfqRepository.findVendorInvite(rfqId, input.vendorId);
    if (!alreadyInvited) {
      await this.rfqRepository.addVendorInvite(rfqId, input.vendorId);
      await this.rfqRepository.updateStatus(rfqId, "SENT");
    }

    await this.emailService.queueRfqEmail({ to: contact.email!, rfqTitle: "RFQ", bodyText: input.text });
    await this.auditService.log({
      actorId,
      action: "RFQ_VENDOR_INVITED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId: input.vendorId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(rfqId, context.businessId);
  }
```

Delete `loadQuickSendContext` (now replaced by `loadInviteVendorContext`) and the old `quickSend`/`previewQuickSend` methods entirely.

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
```

- [ ] **Step 5: Fix the reopen test that referenced `award`**

Find the test at line ~502 ("reopens an AWARDED RFQ back to SENT and clears the awarded vendor") and rewrite it to no longer call `service.award`:

```ts
    it("reopens a CLOSED RFQ back to SENT", async () => {
      const rfq = await createBasicRfq();
      await repository.addVendorInvite(rfq.id, vendorA);
      await service.close(rfq.id, actorId, businessId);
      const reopened = await service.reopen(rfq.id, actorId, businessId);
      expect(reopened.status).toBe("SENT");
    });
```

- [ ] **Step 6: Run the full spec file once more**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.service.ts apps/server/src/modules/rfq/rfq.repository.ts apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts
git commit -m "feat(rfq): replace whole-RFQ award with per-item selection and auto-select-lowest"
```

---

### Task 5: RFQ controller/routes/validation — swap award/quick-send endpoints

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.controller.ts`
- Modify: `apps/server/src/modules/rfq/rfq.routes.ts`
- Modify: `apps/server/src/modules/rfq/rfq.validation.ts`

**Interfaces:**
- Consumes: `selectQuote`/`inviteVendor`/`previewInviteVendor` from Task 4.
- Produces: `POST /rfqs/:id/items/:itemId/select-quote`, `POST /rfqs/:id/invite-vendor/preview`, `POST /rfqs/:id/invite-vendor`. Removes `POST /rfqs/:id/award`, `POST /rfqs/quick-send`, `POST /rfqs/quick-send/preview`.

- [ ] **Step 1: Edit `rfq.validation.ts`**

Delete `awardRfqSchema`/`AwardRfqBody` and `quickSendPreviewSchema`/`QuickSendPreviewBody`/`quickSendSchema`/`QuickSendBody`. Add:

```ts
export const selectQuoteSchema = z.object({
  quoteId: z.string().uuid(),
});
export type SelectQuoteBody = z.infer<typeof selectQuoteSchema>;

export const inviteVendorPreviewSchema = z.object({
  vendorId: z.string().uuid(),
});
export type InviteVendorPreviewBody = z.infer<typeof inviteVendorPreviewSchema>;

export const inviteVendorSchema = inviteVendorPreviewSchema.extend({
  text: z.string().min(1, "Text is required"),
});
export type InviteVendorBody = z.infer<typeof inviteVendorSchema>;
```

- [ ] **Step 2: Edit `rfq.controller.ts`**

Delete the `award` method. Delete `quickSendPreview`/`quickSend`. Add:

```ts
  selectQuote = asyncHandler(async (req, res) => {
    const body = req.body as SelectQuoteBody;
    const rfq = await this.rfqService.selectQuote(
      req.params.id!,
      req.params.itemId!,
      body.quoteId,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "Quote selected");
  });

  previewInviteVendor = asyncHandler(async (req, res) => {
    const body = req.body as InviteVendorPreviewBody;
    const preview = await this.rfqService.previewInviteVendor(req.params.id!, body, req.user!.businessId);
    sendSuccess(res, preview, "Invite preview generated");
  });

  inviteVendor = asyncHandler(async (req, res) => {
    const body = req.body as InviteVendorBody;
    const rfq = await this.rfqService.inviteVendor(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, rfq, "Vendor invited", 201);
  });
```

- [ ] **Step 3: Edit `rfq.routes.ts`**

Delete the `/quick-send/preview`, `/quick-send`, and `/:id/award` route blocks. Add, near the other `:id`-scoped routes (before the bare `/:id` GET, to match the existing ordering convention of static-then-dynamic within each id's sub-path group):

```ts
  router.post(
    "/:id/items/:itemId/select-quote",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    validate(selectQuoteSchema),
    controller.selectQuote,
  );

  router.post(
    "/:id/invite-vendor/preview",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(inviteVendorPreviewSchema),
    controller.previewInviteVendor,
  );

  router.post(
    "/:id/invite-vendor",
    authenticateMiddleware,
    requirePermission("rfq:create"),
    validate(inviteVendorSchema),
    controller.inviteVendor,
  );
```

Note the deliberate permission split: selecting a quote requires `rfq:update` (it's changing the RFQ's own award state), inviting a vendor requires `rfq:create` (per this plan's Global Constraints — preserves Tender Manager's existing capability).

- [ ] **Step 4: Update the OpenAPI JSDoc blocks**

Find the `@openapi` comment blocks above the deleted routes (award, quick-send, quick-send/preview) and replace them with equivalent blocks for the three new routes, following the exact same comment style already used elsewhere in this file (check `close`/`reopen`'s JSDoc immediately above/below for the format to copy).

- [ ] **Step 5: Run the full RFQ test suite and typecheck**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.controller.ts apps/server/src/modules/rfq/rfq.routes.ts apps/server/src/modules/rfq/rfq.validation.ts
git commit -m "feat(rfq): swap award/quick-send routes for select-quote/invite-vendor"
```

---

### Task 6: RFQ mapper — carry `isSelected`, drop `awardedVendorId`

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.mapper.ts`

**Interfaces:**
- Consumes: `RfqQuoteDto`/`RfqListItemDto`/`RfqDto` from Task 2.

- [ ] **Step 1: Edit `toQuoteDto`**

```ts
function toQuoteDto(quote: RfqItemDetail["quotes"][number]): RfqQuoteDto {
  return {
    id: quote.id,
    vendorId: quote.vendorId,
    rate: quote.rate,
    regretted: quote.regretted,
    make: quote.make,
    model: quote.model,
    quotedAt: quote.quotedAt.toISOString(),
    remarks: quote.remarks,
    updatedAt: quote.updatedAt.toISOString(),
    isSelected: quote.isSelected,
  };
}
```

- [ ] **Step 2: Delete `awardedVendorId` from `toRfqListItemDto` and `toRfqDto`**

Remove the `awardedVendorId: entity.awardedVendorId,` line from both functions.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.mapper.ts
git commit -m "feat(rfq): map isSelected through to the DTO, drop awardedVendorId"
```

---

### Task 7: HistoricalRate — add `recordFromRfqQuote` (transactional `isDefault` flip)

**Files:**
- Modify: `apps/server/src/modules/rates/rates.repository.ts`
- Test: `apps/server/src/modules/rates/__tests__/rates.repository.integration.spec.ts` (create if it doesn't already cover this — check `rates-ann.integration.spec.ts` first; if a plain, non-ANN repository integration spec doesn't exist, create this new file following that same file's setup pattern for business/user/vendor fixtures).

**Interfaces:**
- Produces: `recordFromRfqQuote(data: { businessId: string; itemName: string; unit: string; rate: number; vendorId: string; rfqQuoteId: string; sourceTenderId?: string | null; createdById: string }): Promise<void>` on `IHistoricalRatesRepository` (or wherever the repository interface is named — verify exact interface name first: `grep -n "interface I.*Rate" apps/server/src/modules/rates/rates.repository.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HistoricalRatesRepository } from "../rates.repository.js";

describe("HistoricalRatesRepository.recordFromRfqQuote (integration)", () => {
  let repository: HistoricalRatesRepository;
  let businessId: string;
  let userId: string;
  let vendorId: string;

  beforeAll(async () => {
    repository = new HistoricalRatesRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Rates Repo Test ${randomUUID()}`, code: `RRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `rates-repo-test-${randomUUID()}@example.com`,
        firstName: "Rates",
        lastName: "Test",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
    const vendor = await prisma.vendor.create({
      data: { id: randomUUID(), name: "Rates Test Vendor", category: "MATERIAL_SUPPLIER", createdById: userId },
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { businessId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("marks the new row as default and clears any prior default for the same itemName", async () => {
    await repository.recordFromRfqQuote({
      businessId,
      itemName: "OPC Cement",
      unit: "bag",
      rate: 400,
      vendorId,
      rfqQuoteId: randomUUID(),
      createdById: userId,
    });
    const second = randomUUID();
    await repository.recordFromRfqQuote({
      businessId,
      itemName: "OPC Cement",
      unit: "bag",
      rate: 380,
      vendorId,
      rfqQuoteId: second,
      createdById: userId,
    });

    const rows = await prisma.historicalRate.findMany({ where: { businessId, itemName: "OPC Cement" } });
    expect(rows).toHaveLength(2);
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.rfqQuoteId).toBe(second);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rates/__tests__/rates.repository.integration.spec.ts
```

- [ ] **Step 3: Implement**

Add to `IHistoricalRatesRepository` and the class:

```ts
  async recordFromRfqQuote(data: {
    businessId: string;
    itemName: string;
    unit: string;
    rate: number;
    vendorId: string;
    rfqQuoteId: string;
    sourceTenderId?: string | null;
    createdById: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.historicalRate.updateMany({
        where: { businessId, itemName: data.itemName, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.historicalRate.create({
        data: {
          id: randomUUID(),
          businessId,
          category: "MATERIAL",
          itemName: data.itemName,
          unit: data.unit,
          rate: data.rate,
          effectiveDate: new Date(),
          sourceTenderId: data.sourceTenderId ?? null,
          vendorId: data.vendorId,
          rfqQuoteId: data.rfqQuoteId,
          isDefault: true,
          createdById: data.createdById,
        },
      }),
    ]);
  }
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rates/__tests__/rates.repository.integration.spec.ts
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/rates/rates.repository.ts apps/server/src/modules/rates/__tests__/
git commit -m "feat(rates): record vendor-attributed historical rates from RFQ quotes"
```

---

### Task 8: RFQ service — `pushRatesToTender`

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts`
- Modify: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Consumes: `recordFromRfqQuote` from Task 7, `IBoqRepository` (already injected into `RfqService` per the existing constructor — verify the exact update-item method name: `grep -n "updateItem\|updateRate" apps/server/src/modules/boq/boq.repository.ts`), `IHistoricalRatesRepository` (new constructor dependency — add it).
- Produces: `RfqService#pushRatesToTender(rfqId, actorId, businessId): Promise<{ updatedItems: number }>`.

- [ ] **Step 1: Check the exact BOQ item rate-update method**

```bash
grep -n "async update" apps/server/src/modules/boq/boq.repository.ts
```

Use whatever the real method signature is (likely `updateItem(id: string, data: UpdateBoqItemData)` per the earlier-seen `UpdateBoqItemData` type) in the implementation step below — adjust the call to match exactly.

- [ ] **Step 2: Write the failing test**

```ts
  it("pushes selected rates onto the tender's BOQ items and records historical rates", async () => {
    boqRepository.items.set(randomUUID(), {} as never); // ensure fake has the shape available if needed
    const boqItemId = randomUUID();
    const rfq = await service.create(
      {
        title: "Push Test RFQ",
        tenderId: undefined,
        items: [{ boqItemId, description: "OPC Cement", unit: "bag", quantity: 100 }],
      },
      actorId,
      { businessId },
    );
    await repository.addVendorInvite(rfq.id, vendorA);
    await service.upsertQuote(rfq.items[0]!.id, vendorA, { rate: 375, regretted: false }, actorId, businessId);
    await service.close(rfq.id, actorId, businessId);

    const result = await service.pushRatesToTender(rfq.id, actorId, businessId);
    expect(result.updatedItems).toBe(1);
    expect(boqRepository.updatedRates.get(boqItemId)).toBe(375);
  });

  it("refuses to push rates for an RFQ that isn't closed", async () => {
    const rfq = await createBasicRfq();
    await expect(service.pushRatesToTender(rfq.id, actorId, businessId)).rejects.toThrow(ConflictError);
  });
```

Add a `updatedRates` tracking map to `FakeBoqRepository` and an `updateItem` method:

```ts
class FakeBoqRepository implements Partial<IBoqRepository> {
  items = new Map<string, BoqItemWithBreakdown>();
  updatedRates = new Map<string, number>();

  async findItemsByIds(ids: string[], _businessId: string) {
    return ids.map((id) => this.items.get(id)).filter((item): item is BoqItemWithBreakdown => Boolean(item));
  }

  async updateItem(id: string, data: { rate?: number }) {
    if (data.rate !== undefined) this.updatedRates.set(id, data.rate);
  }
}
```

Add a `FakeHistoricalRatesRepository` and wire it into the `service = new RfqService(...)` constructor call in `beforeEach`:

```ts
class FakeHistoricalRatesRepository {
  recorded: { itemName: string; rate: number; vendorId: string }[] = [];
  async recordFromRfqQuote(data: { itemName: string; rate: number; vendorId: string }) {
    this.recorded.push(data);
  }
}
```

```ts
    ratesRepository = new FakeHistoricalRatesRepository();
    service = new RfqService(
      repository as unknown as IRfqRepository,
      tendersRepository as unknown as ITendersRepository,
      vendorsRepository as unknown as IVendorsRepository,
      boqRepository as unknown as IBoqRepository,
      usersRepository as unknown as IUsersRepository,
      businessesRepository as unknown as IBusinessesRepository,
      emailService as unknown as EmailService,
      auditService,
      ratesRepository as unknown as IHistoricalRatesRepository,
    );
```

(Declare `let ratesRepository: FakeHistoricalRatesRepository;` alongside the other `let` declarations at the top of the `describe` block.)

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
```

- [ ] **Step 4: Implement**

Add `ratesRepository: IHistoricalRatesRepository` as a new constructor parameter on `RfqService` (last position, matching the test's call order above) and store it as `private readonly`.

Add the method:

```ts
  async pushRatesToTender(rfqId: string, actorId: string, businessId: string): Promise<{ updatedItems: number }> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    if (rfq.status !== "CLOSED") {
      throw new ConflictError("RFQ must be closed before pushing rates to the tender");
    }

    let updatedItems = 0;
    for (const item of rfq.items) {
      if (!item.boqItemId) continue;
      const selected = item.quotes.find((q) => q.isSelected);
      if (!selected || selected.rate === null) continue;

      await this.boqRepository.updateItem(item.boqItemId, { rate: selected.rate });
      await this.ratesRepository.recordFromRfqQuote({
        businessId,
        itemName: item.description,
        unit: item.unit ?? "unit",
        rate: selected.rate,
        vendorId: selected.vendorId,
        rfqQuoteId: selected.id,
        sourceTenderId: rfq.tenderId,
        createdById: actorId,
      });
      updatedItems += 1;
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_RATES_PUSHED_TO_TENDER",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { updatedItems },
    });
    return { updatedItems };
  }
```

Update every other place `new RfqService(` is called in production code (the module composition root — find it):

```bash
grep -rn "new RfqService(" apps/server/src/modules/rfq/rfq.module.ts
```

Add the real `historicalRatesRepository` singleton (import it from the rates module, matching the pattern CLAUDE.md documents for cross-module singleton reuse — e.g. `import { historicalRatesRepository } from "../rates/rates.module.js";`).

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq/__tests__/rfq.service.spec.ts
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.service.ts apps/server/src/modules/rfq/rfq.module.ts apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts
git commit -m "feat(rfq): push selected rates to the tender's BOQ and record historical rates on close"
```

---

### Task 9: RFQ controller/routes — expose `pushRatesToTender`

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.controller.ts`
- Modify: `apps/server/src/modules/rfq/rfq.routes.ts`

**Interfaces:**
- Consumes: `pushRatesToTender` from Task 8.
- Produces: `POST /rfqs/:id/push-rates-to-tender`.

- [ ] **Step 1: Add the controller method**

```ts
  pushRatesToTender = asyncHandler(async (req, res) => {
    const result = await this.rfqService.pushRatesToTender(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, result, "Rates pushed to tender");
  });
```

- [ ] **Step 2: Add the route**

```ts
  router.post(
    "/:id/push-rates-to-tender",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    controller.pushRatesToTender,
  );
```

Add the matching `@openapi` JSDoc block, copying the style of `close`/`reopen`'s.

- [ ] **Step 3: Typecheck and run the RFQ suite**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.controller.ts apps/server/src/modules/rfq/rfq.routes.ts
git commit -m "feat(rfq): expose push-rates-to-tender endpoint"
```

---

### Task 10: Purchase Orders service — multi-vendor `createFromRfq`

**Files:**
- Modify: `apps/server/src/modules/purchase-orders/purchase-orders.service.ts`
- Modify: `apps/server/src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts`
- Modify: `packages/types/src/purchase-order.ts`

**Interfaces:**
- Consumes: `RfqItem.quotes[].isSelected` from Task 1/2.
- Produces: `PurchaseOrdersService#createFromRfq(rfqId, options, actorId, context): Promise<PurchaseOrderDto[]>`.

- [ ] **Step 1: Update `packages/types/src/purchase-order.ts`**

The endpoint's declared success payload becomes an array — no type change needed to `CreatePurchaseOrderFromRfqInput` itself (still `{ rfqId, expectedDeliveryDate?, notes? }`), only to how the hook/controller type the response (handled in Tasks 11/13).

- [ ] **Step 2: Write the failing tests**

Replace the three existing `createFromRfq`-related tests (the "creates a purchase order from an awarded RFQ", "refuses to build... regretted quote", and "rejects creating a PO from an RFQ that hasn't been awarded" tests, all using the now-removed `AWARDED`/`awardedVendorId` shape) with:

```ts
  it("creates one PO per vendor when items are split across selected quotes", async () => {
    const rfqId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      tenderId: null,
      status: "CLOSED",
      items: [
        {
          id: itemA,
          description: "OPC Cement",
          unit: "bag",
          quantity: 200,
          quotes: [{ vendorId: "vendor-a", rate: 375, isSelected: true, regretted: false }],
        },
        {
          id: itemB,
          description: "TMT Steel",
          unit: "ton",
          quantity: 10,
          quotes: [{ vendorId: "vendor-b", rate: 61000, isSelected: true, regretted: false }],
        },
      ],
    } as unknown as RfqDetail);
    vendorsRepository.vendorIds.add("vendor-a");
    vendorsRepository.vendorIds.add("vendor-b");

    const pos = await service.createFromRfq(rfqId, {}, actorId, { businessId });
    expect(pos).toHaveLength(2);
    const vendorAPo = pos.find((po) => po.items.some((i) => i.description === "OPC Cement"))!;
    const vendorBPo = pos.find((po) => po.items.some((i) => i.description === "TMT Steel"))!;
    expect(vendorAPo.items).toHaveLength(1);
    expect(vendorBPo.items).toHaveLength(1);
    expect(vendorAPo.sourceRfqId).toBe(rfqId);
  });

  it("excludes items with no selected quote rather than failing the whole call", async () => {
    const rfqId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      tenderId: null,
      status: "CLOSED",
      items: [
        {
          id: itemA,
          description: "OPC Cement",
          unit: "bag",
          quantity: 200,
          quotes: [{ vendorId: "vendor-a", rate: 375, isSelected: true, regretted: false }],
        },
        {
          id: itemB,
          description: "Unresolved Item",
          unit: "nos",
          quantity: 5,
          quotes: [{ vendorId: "vendor-a", rate: 100, isSelected: false, regretted: false }],
        },
      ],
    } as unknown as RfqDetail);
    vendorsRepository.vendorIds.add("vendor-a");

    const pos = await service.createFromRfq(rfqId, {}, actorId, { businessId });
    expect(pos).toHaveLength(1);
    expect(pos[0]!.items).toHaveLength(1);
    expect(pos[0]!.items[0]!.description).toBe("OPC Cement");
  });

  it("rejects creating a PO from an RFQ that isn't closed", async () => {
    const rfqId = randomUUID();
    rfqRepository.rfqs.set(rfqId, {
      id: rfqId,
      status: "SENT",
      items: [],
    } as unknown as RfqDetail);

    await expect(service.createFromRfq(rfqId, {}, actorId, { businessId })).rejects.toThrow(ConflictError);
  });
```

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts
```

- [ ] **Step 4: Implement**

Replace `createFromRfq` entirely:

```ts
  async createFromRfq(
    rfqId: string,
    options: { expectedDeliveryDate?: Date; notes?: string },
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<PurchaseOrderDto[]> {
    const rfq = await this.rfqRepository.findById(rfqId, context.businessId);
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (rfq.status !== "CLOSED") {
      throw new ConflictError("RFQ must be closed before creating a purchase order");
    }

    const itemsByVendor = new Map<string, CreatePurchaseOrderItemData[]>();
    for (const item of rfq.items) {
      const selected = item.quotes.find((q) => q.isSelected);
      if (!selected || selected.regretted || selected.rate === null) continue;

      const rate = selected.rate;
      const list = itemsByVendor.get(selected.vendorId) ?? [];
      list.push({
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        rate,
        amount: round2(item.quantity * rate),
        sortOrder: list.length,
      });
      itemsByVendor.set(selected.vendorId, list);
    }

    const created: PurchaseOrderDto[] = [];
    for (const [vendorId, items] of itemsByVendor) {
      const poId = await this.purchaseOrdersRepository.create({
        vendorId,
        tenderId: rfq.tenderId,
        businessId: context.businessId,
        sourceRfqId: rfq.id,
        expectedDeliveryDate: options.expectedDeliveryDate ?? null,
        notes: options.notes ?? null,
        createdById: actorId,
        items,
      });
      created.push(await this.getById(poId, context.businessId));
    }

    await this.auditService.log({
      actorId,
      action: "PURCHASE_ORDER_CREATED_FROM_RFQ",
      entityType: "PurchaseOrder",
      entityId: rfqId,
      metadata: { rfqId, count: created.length },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return created;
  }
```

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/purchase-orders/purchase-orders.service.ts apps/server/src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts packages/types/src/purchase-order.ts
git commit -m "feat(purchase-orders): create one PO per vendor when an RFQ's items split across vendors"
```

---

### Task 11: Purchase Orders controller/routes — array response

**Files:**
- Modify: `apps/server/src/modules/purchase-orders/purchase-orders.controller.ts`

**Interfaces:**
- Consumes: `createFromRfq` returning `PurchaseOrderDto[]` from Task 10.

- [ ] **Step 1: Find and update the controller method**

```bash
grep -n "createFromRfq" apps/server/src/modules/purchase-orders/purchase-orders.controller.ts
```

Change its `sendSuccess` call's status code comment/message if needed (e.g. "Purchase order created" → "Purchase order(s) created") — the payload is now whatever `createFromRfq` returns, no explicit reshaping needed since the controller just passes the array through.

- [ ] **Step 2: Update the `@openapi` JSDoc for this route to reflect an array response**

- [ ] **Step 3: Run the full purchase-orders + rfq suites and typecheck**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/purchase-orders src/modules/rfq
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/modules/purchase-orders/purchase-orders.controller.ts
git commit -m "feat(purchase-orders): return an array from the from-rfq endpoint"
```

---

### Task 12: Full server regression before touching the frontend

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full server test suite**

```bash
docker compose exec -T redis redis-cli FLUSHALL
pnpm --filter @bmp/server exec vitest run
```

- [ ] **Step 2: Compare failures against the known baseline**

The only expected pre-existing failures are: the login-rate-limiter cascade (documented in this repo's CLAUDE.md) and `incoming-tenders.service.integration.spec.ts`'s already-fixed assertion (should now be passing — if it fails, something else broke it; investigate). Any RFQ/purchase-orders/rates failure beyond what earlier tasks already accounted for must be fixed before proceeding.

- [ ] **Step 2: Full server typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 3: No commit** — this task is a checkpoint, not a code change.

---

### Task 13: Frontend hooks — `use-rfq.ts` and `use-purchase-orders.ts`

**Files:**
- Modify: `apps/web/src/hooks/use-rfq.ts`
- Modify: `apps/web/src/hooks/use-purchase-orders.ts`

**Interfaces:**
- Consumes: `SelectQuoteInput`, `InviteVendorInput`, `InviteVendorPreviewInput`, `InviteVendorPreviewDto` from Task 2.
- Produces: `useSelectQuote(rfqId)`, `usePushRatesToTender(rfqId)`, `useInviteVendor()`, `usePreviewInviteVendor()`. `useCreatePurchaseOrderFromRfq` now resolves `PurchaseOrderDto[]`.

- [ ] **Step 1: Edit `use-rfq.ts`**

Delete `useAwardRfq`. Add:

```ts
export function useSelectQuote(rfqId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, quoteId }: { itemId: string; quoteId: string }) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(
        `/rfqs/${rfqId}/items/${itemId}/select-quote`,
        { quoteId },
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, rfqId),
  });
}

export function usePushRatesToTender(rfqId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<{ updatedItems: number }>>(
        `/rfqs/${rfqId}/push-rates-to-tender`,
      );
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, rfqId),
  });
}
```

Replace `usePreviewQuickSendRfq`/`useQuickSendRfq` with:

```ts
export function usePreviewInviteVendor(rfqId: string) {
  return useMutation({
    mutationFn: async (input: InviteVendorPreviewInput) => {
      const response = await apiClient.post<ApiResponse<InviteVendorPreviewDto>>(
        `/rfqs/${rfqId}/invite-vendor/preview`,
        input,
      );
      return unwrap(response.data);
    },
  });
}

export function useInviteVendor(rfqId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InviteVendorInput) => {
      const response = await apiClient.post<ApiResponse<RfqDto>>(`/rfqs/${rfqId}/invite-vendor`, input);
      return unwrap(response.data);
    },
    onSuccess: () => invalidateRfq(queryClient, rfqId),
  });
}
```

Note both now take `rfqId` as a hook argument (matching `useAddRfqVendor(id)`'s existing pattern) rather than in the mutation input, since the RFQ already exists.

Update the `import type { ... }` block at the top to swap `AwardRfqInput`, `QuickSendRfqInput`, `QuickSendRfqPreviewDto`, `QuickSendRfqPreviewInput` for `SelectQuoteInput`, `InviteVendorInput`, `InviteVendorPreviewDto`, `InviteVendorPreviewInput`.

- [ ] **Step 2: Edit `use-purchase-orders.ts`**

```ts
export function useCreatePurchaseOrderFromRfq() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePurchaseOrderFromRfqInput) => {
      const response = await apiClient.post<ApiResponse<PurchaseOrderDto[]>>(
        "/purchase-orders/from-rfq",
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: errors in `rfqs/[id]/page.tsx`, `send-rfq-dialog.tsx`, `boq-item-grid.tsx` — fixed in the remaining tasks.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-rfq.ts apps/web/src/hooks/use-purchase-orders.ts
git commit -m "feat(web): add per-item selection and invite-vendor hooks, retire whole-RFQ award hook"
```

---

### Task 14: `quote-cell.tsx` — add a per-item select control

**Files:**
- Modify: `apps/web/src/components/rfq/quote-cell.tsx`

**Interfaces:**
- Produces: `QuoteCell` gains an `isSelected: boolean` prop and an `onSelect: () => void` callback, rendering a small selectable control next to the rate input.

- [ ] **Step 1: Edit the component**

```tsx
"use client";

import { Button } from "@bmp/ui";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@bmp/ui";

export function QuoteCell({
  initialRate,
  onCommit,
  disabled,
  isSelected,
  onSelect,
  selectable,
}: {
  initialRate: number | null;
  onCommit: (rate: number) => void;
  disabled?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  selectable?: boolean;
}) {
  const [value, setValue] = useState(initialRate !== null ? String(initialRate) : "");

  useEffect(() => {
    setValue(initialRate !== null ? String(initialRate) : "");
  }, [initialRate]);

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const parsed = Number(value);
          if (value.trim() !== "" && !Number.isNaN(parsed) && parsed !== initialRate) {
            onCommit(parsed);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Rate"
        className="h-8 w-24"
      />
      {selectable && initialRate !== null && (
        <Button
          type="button"
          size="icon"
          variant={isSelected ? "default" : "outline"}
          className="h-8 w-8 shrink-0"
          onClick={onSelect}
          aria-label={isSelected ? "Selected as final rate" : "Select as final rate"}
          title={isSelected ? "Selected as final rate" : "Select as final rate"}
        >
          <Check className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
```

(Remove the duplicate `Input` import if the file already had one at the top — keep a single import line.)

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/rfq/quote-cell.tsx
git commit -m "feat(web): add a per-item quote selection control to QuoteCell"
```

---

### Task 15: `rfqs/[id]/page.tsx` — remove whole-RFQ award UI, wire per-item selection, relocate Send RFQ, add Push-to-tender

**Files:**
- Modify: `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`

**Interfaces:**
- Consumes: `useSelectQuote`, `usePushRatesToTender`, `useInviteVendor`, `usePreviewInviteVendor` from Task 13; `QuoteCell`'s new props from Task 14.

- [ ] **Step 1: Update imports**

Replace:

```tsx
import {
  useAddRfqVendor,
  useAwardRfq,
  useCloseRfq,
  useReopenRfq,
  useRemoveRfqVendor,
  useRfq,
  useRfqComparison,
  useUpsertRfqQuote,
} from "@/hooks/use-rfq";
```

with:

```tsx
import {
  useAddRfqVendor,
  useCloseRfq,
  useInviteVendor,
  usePreviewInviteVendor,
  usePushRatesToTender,
  useReopenRfq,
  useRemoveRfqVendor,
  useRfq,
  useRfqComparison,
  useSelectQuote,
  useUpsertRfqQuote,
} from "@/hooks/use-rfq";
```

Add near the top-level imports:

```tsx
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select as VendorSelect,
  Textarea,
} from "@bmp/ui";
import { Send } from "lucide-react";
```

(Reuse the existing `Select`/`SelectContent`/etc. already imported for the invite-vendor picker rather than aliasing — check the file's current imports first and only add what's genuinely missing: `Dialog*`, `Textarea`, `Send` icon.)

- [ ] **Step 2: Update `STATUS_VARIANT` and `isFinalized`**

```tsx
const STATUS_VARIANT: Record<string, "success" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  CLOSED: "success",
  CANCELLED: "destructive",
};
```

```tsx
  const isFinalized = rfq.status === "CLOSED" || rfq.status === "CANCELLED";
```

- [ ] **Step 3: Replace hooks and handlers**

Delete `const awardRfq = useAwardRfq(params.id);` and `const [awardVendorId, setAwardVendorId] = useState("");` and `handleAward`.

Add:

```tsx
  const selectQuote = useSelectQuote(params.id);
  const pushRatesToTender = usePushRatesToTender(params.id);
  const previewInvite = usePreviewInviteVendor(params.id);
  const inviteVendorMutation = useInviteVendor(params.id);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendVendorId, setSendVendorId] = useState("");
  const [sendText, setSendText] = useState("");

  async function handleSelectQuote(itemId: string, quoteId: string) {
    try {
      await selectQuote.mutateAsync({ itemId, quoteId });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not select quote",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handlePushRates() {
    try {
      const result = await pushRatesToTender.mutateAsync();
      toast({ title: `Pushed rates for ${result.updatedItems} item(s) to the tender` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not push rates",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleSendRfq() {
    if (!sendVendorId) return;
    try {
      await inviteVendorMutation.mutateAsync({ vendorId: sendVendorId, text: sendText });
      toast({ title: "RFQ sent" });
      setSendDialogOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not send RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }
```

Add an effect to load the preview text when a vendor is picked in the send dialog:

```tsx
  useEffect(() => {
    if (!sendDialogOpen || !sendVendorId) return;
    let cancelled = false;
    previewInvite.mutateAsync({ vendorId: sendVendorId }).then((result) => {
      if (!cancelled) setSendText(result.text);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendDialogOpen, sendVendorId]);
```

(Add `useEffect` to the `react` import if not already present — it is, per the existing `useState` import line; change it to `import { useEffect, useState } from "react";`.)

- [ ] **Step 4: Update the header action row**

Replace:

```tsx
        {rfq.status === "AWARDED" && canCreatePo && (
          <Button onClick={handleCreatePo}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Create Purchase Order
          </Button>
        )}
```

with:

```tsx
        {canSendRfq && !isFinalized && (
          <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Send className="mr-2 h-4 w-4" /> Send RFQ
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Send RFQ</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Vendor</label>
                  <Select value={sendVendorId} onValueChange={setSendVendorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {(vendorsQuery.data?.items ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Message</label>
                  <Textarea
                    rows={10}
                    value={sendText}
                    onChange={(e) => setSendText(e.target.value)}
                    disabled={previewInvite.isPending}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleSendRfq}
                  disabled={inviteVendorMutation.isPending || previewInvite.isPending || !sendVendorId}
                >
                  {inviteVendorMutation.isPending ? "Sending…" : "Send"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {isFinalized && rfq.status === "CLOSED" && canUpdate && (
          <Button variant="outline" onClick={handlePushRates} disabled={pushRatesToTender.isPending}>
            Push rates to tender
          </Button>
        )}
        {rfq.status === "CLOSED" && canCreatePo && (
          <Button onClick={handleCreatePo}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Create Purchase Order(s)
          </Button>
        )}
```

Add `const canSendRfq = hasPermission(roleName, "rfq:create");` alongside the existing `canUpdate`/`canCreatePo` declarations near the top of the component.

- [ ] **Step 5: Update `handleCreatePo` for the array response**

```tsx
  async function handleCreatePo() {
    try {
      const pos = await createPoFromRfq.mutateAsync({ rfqId: params.id });
      toast({ title: `${pos.length} purchase order(s) created` });
      if (pos.length === 1) {
        router.push(`/purchase-orders/${pos[0]!.id}`);
      } else {
        router.push("/purchase-orders");
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create purchase order(s)",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }
```

- [ ] **Step 6: Add the select control to the quote table**

In the items/quotes table's per-vendor `<TableCell>`, replace the `<QuoteCell ... />` call with:

```tsx
                            <QuoteCell
                              initialRate={quote?.rate ?? null}
                              disabled={!canUpdate || isFinalized}
                              isSelected={quote?.isSelected ?? false}
                              selectable={Boolean(quote) && !quote?.regretted}
                              onSelect={() => quote && handleSelectQuote(item.id, quote.id)}
                              onCommit={(rate) =>
                                upsertQuote.mutate({ itemId: item.id, vendorId: invite.vendor.id, input: { rate } })
                              }
                            />
```

`quote.id` is available directly — `RfqQuoteDto.id` and its mapping were already added in Task 2/Task 6.

- [ ] **Step 7: Remove the whole-RFQ Award UI block**

Delete the entire `{canUpdate && !isFinalized && (<div className="flex gap-2">... Award RFQ ...</div>)}` block inside the "Comparative statement" `Card` (the vendor `<Select>` + "Award RFQ" `<Button>`).

- [ ] **Step 8: Remove the old inline "Invite vendor" selector**

Delete the `{canUpdate && !isFinalized && (<div className="flex gap-2">... Invite ...</div>)}` block inside the "Invited vendors" `Card` — vendor invitation now happens exclusively through the relocated "Send RFQ" dialog in the header, which invites-and-emails in one step. Remove the now-unused `useAddRfqVendor`/`handleInvite`/`inviteVendorId` state if nothing else in the file uses them (`useRemoveRfqVendor` stays — removing an already-invited vendor is still useful and unrelated to this change).

- [ ] **Step 9: Typecheck and manually verify**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx apps/server/src/modules/rfq/rfq.mapper.ts packages/types/src/rfq.ts
git commit -m "feat(web): per-item quote selection UI, relocate Send RFQ, add Push-rates-to-tender"
```

---

### Task 16: `rfqs/new/page.tsx` — pre-fill tender from `?tenderId=`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/rfqs/new/page.tsx`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Add the query param read**

Add `useSearchParams` to the `next/navigation` import:

```tsx
import { useRouter, useSearchParams } from "next/navigation";
```

Add, right after `const router = useRouter();`:

```tsx
  const searchParams = useSearchParams();
  const initialTenderId = searchParams.get("tenderId") ?? "";
```

Change the `tenderId` state initializer:

```tsx
  const [tenderId, setTenderId] = useState<string>(initialTenderId);
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 3: Manually verify**

Navigate to `/rfqs/new?tenderId=<a-real-tender-id>` in a running dev server and confirm the tender dropdown shows that tender pre-selected and its BOQ items load into the picker.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(dashboard)/rfqs/new/page.tsx
git commit -m "feat(web): pre-select the tender on /rfqs/new via ?tenderId="
```

---

### Task 17: `boq-item-grid.tsx` — replace "Send RFQ" with "Create RFQ", delete `SendRfqDialog`

**Files:**
- Modify: `apps/web/src/components/boq/boq-item-grid.tsx`
- Delete: `apps/web/src/components/boq/send-rfq-dialog.tsx`

**Interfaces:**
- Consumes: nothing new (plain navigation).

- [ ] **Step 1: Edit `boq-item-grid.tsx`**

Remove the import: `import { SendRfqDialog } from "./send-rfq-dialog";`. Add:

```tsx
import { useRouter } from "next/navigation";
```

Add `const router = useRouter();` near the top of the component (check it isn't already there under a different name first).

Replace the `<SendRfqDialog ... />` block:

```tsx
          {canSendRfq && (
            <SendRfqDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Send className="mr-2 h-4 w-4" /> Send RFQ
                </Button>
              }
              tenderId={tenderId}
              boqItemIds={[...selectedIds]}
              suggestedVendorId={suggestions?.recommended[0]?.vendorId}
              onSent={() => setSelectedIds(new Set())}
            />
          )}
```

with:

```tsx
          {canSendRfq && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/rfqs/new?tenderId=${tenderId}`)}
            >
              <Send className="mr-2 h-4 w-4" /> Create RFQ
            </Button>
          )}
```

- [ ] **Step 2: Delete the dialog file**

```bash
rm apps/web/src/components/boq/send-rfq-dialog.tsx
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 4: Manually verify**

In a running dev server: open a tender's Items tab, select one or more rows, click "Create RFQ", confirm it navigates to `/rfqs/new?tenderId=<that tender>` with the tender pre-selected (per Task 16).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/boq/boq-item-grid.tsx
git rm apps/web/src/components/boq/send-rfq-dialog.tsx
git commit -m "feat(web): replace tender Items tab's Send RFQ with Create RFQ, delete the old quick-send dialog"
```

---

### Task 18: Final cleanup and full regression

**Files:** none (verification and dead-code check only).

- [ ] **Step 1: Dead-code check**

```bash
grep -rln "QuickSendRfq\|AwardRfqInput\|awardedVendorId\|useAwardRfq\|setAwardedVendor" apps/server/src apps/web/src packages/types/src
```

Every remaining hit should be either a comment explaining history, or genuinely nothing (empty result). Fix any real leftover reference found.

- [ ] **Step 2: Full server test suite**

```bash
docker compose exec -T redis redis-cli FLUSHALL
pnpm --filter @bmp/server exec vitest run
```

Compare against the same known baseline as Task 12.

- [ ] **Step 3: Full web typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 4: Manual end-to-end smoke test in a running dev server**

1. Open a tender with BOQ items, select several, click "Create RFQ" — confirm it lands on `/rfqs/new` with the tender pre-filled.
2. Pick multiple vendors, submit — confirm the RFQ is created and multiple vendors are invited.
3. On the RFQ detail page, enter quotes for at least 2 vendors on the same item — confirm the cheaper one shows as selected automatically.
4. Click the select control on the other (more expensive) vendor's quote — confirm the selection moves and stays there even after entering a new, cheaper quote for a third vendor on the same item.
5. Close the RFQ. Confirm "Send RFQ", quote inputs, and the removed Award UI are all correctly gone/disabled; "Push rates to tender" and "Create Purchase Order(s)" appear.
6. Click "Push rates to tender" — confirm the toast reports the right item count, and the originating tender's BOQ item rate is now pre-filled with the selected quote's rate (still editable).
7. Click "Create Purchase Order(s)" with items split across 2 vendors — confirm 2 POs are created.
8. Check the historical rates admin view (or query the DB directly) for a new `HistoricalRate` row with the right `vendorId` and `isDefault: true`.

- [ ] **Step 5: No commit** — this task is a final checkpoint.
