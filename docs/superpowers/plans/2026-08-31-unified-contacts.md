# Unified Contacts (Organizations + Vendors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated `OrganizationContact`/`VendorContact` models with one polymorphic `Contact` model supporting multiple phones/emails per contact (each independently primary), a notes field, and department/designation searchable dropdowns with inline "add if missing" — with one shared backend module and one shared, redesigned frontend card/dialog used by both Organizations and Vendors.

**Architecture:** A new `apps/server/src/modules/contacts/` module (repository/service/mapper) owns all `Contact`/`ContactPhone`/`ContactEmail`/`ContactLookupOption` persistence, following this codebase's `entityType`/`entityId` polymorphic-reference convention (as used by `Attachment`/`AuditLog`). `OrganizationsService`/`VendorsService` delegate their existing `addContact`/`updateContact`/`deleteContact` actions to the new `ContactsService` instead of owning the rows themselves — existing routes, URLs, and permissions are unchanged. One new shared `Combobox` component (`packages/ui`) and one shared `ContactCard`/`ContactDialog`/`ContactSearchBar` set (`apps/web`) replace the two near-duplicate frontend implementations.

**Tech Stack:** Prisma/PostgreSQL, Express/TypeScript, Next.js/React, Vitest, hand-written fake repositories (no mocking framework), `fuzzysort` (new dependency) for client-side fuzzy search, `@radix-ui/react-popover` (already a dependency, used by the existing `MultiSelect`) for the new `Combobox`.

**Spec:** `docs/superpowers/specs/2026-08-31-unified-contacts-design.md`

## Global Constraints

- `Contact.entityType` is a real Prisma enum (`ORGANIZATION`/`VENDOR`), not a bare `String?` like `Attachment.entityType` — deliberate, since `Contact` has exactly two known, closed consumers (unlike `Attachment`, which is genuinely open-ended).
- `Organization` and `Vendor` are both global/shared entities (no `businessId` field on either), but `ContactLookupOption` is business-scoped. Every write path that can register a new lookup option (`addContact`/`updateContact`) must thread through the *acting* business id (`req.user!.businessId`), not an organization/vendor id.
- `updateContact`'s `phones`/`emails` arrays are a full replace, never a diff: when either array key is present in the update payload, all of that contact's existing `ContactPhone`/`ContactEmail` rows are deleted and recreated from the submitted array in the same transaction. Phone/email entries carry no `id` on the write side for this reason.
- Every `isPrimary` flip that can conflict with a sibling row (a new/updated `Contact.isPrimary = true` unsetting any other primary contact for the same `entityType`+`entityId`) is transactional — unset-then-set in one `prisma.$transaction`, mirroring this codebase's established `isCurrent`/`isSelected` convention. `ContactPhone.isPrimary`/`ContactEmail.isPrimary` do NOT need this cross-row transactional treatment: their "at most one primary" invariant is enforced by Zod validation on the submitted array (not by comparing against existing DB rows), since the whole array is replaced atomically every time.
- Existing routes, URLs, and permission gates (`organizations:update`, `vendors:update`) for contact create/update/delete are unchanged. No new permission keys are introduced anywhere in this plan.
- `BusinessContact` is explicitly out of scope — do not touch it.
- This codebase has no frontend component test files anywhere (`apps/web/src`, `packages/ui/src`) despite vitest being configured — new UI components in this plan do not get dedicated test files, matching established convention. Verification for UI tasks is a live manual check in a running dev server.

---

### Task 1: Schema migration — `Contact`/`ContactPhone`/`ContactEmail`/`ContactLookupOption`, drop `OrganizationContact`/`VendorContact`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<timestamp>_unified_contacts/migration.sql`

**Interfaces:**
- Produces: `Contact`, `ContactPhone`, `ContactEmail`, `ContactLookupOption` Prisma models; `ContactEntityType` (`ORGANIZATION`|`VENDOR`) and `ContactLookupKind` (`DEPARTMENT`|`DESIGNATION`) enums. Removes `OrganizationContact`, `VendorContact`, and their back-relations on `Organization`/`Vendor`.

- [ ] **Step 1: Edit `schema.prisma`**

Add these two enums and four models, placed near the `Organization`/`Vendor` models (e.g. immediately before the `Organization` model):

```prisma
enum ContactEntityType {
  ORGANIZATION
  VENDOR
}

enum ContactLookupKind {
  DEPARTMENT
  DESIGNATION
}

model Contact {
  id          String            @id @default(uuid())
  entityType  ContactEntityType
  entityId    String
  name        String
  department  String?
  designation String?
  notes       String?
  isPrimary   Boolean           @default(false)

  phones ContactPhone[]
  emails ContactEmail[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([entityType, entityId])
  @@map("contacts")
}

model ContactPhone {
  id        String  @id @default(uuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  phone     String
  isPrimary Boolean @default(false)

  @@index([contactId])
  @@map("contact_phones")
}

model ContactEmail {
  id        String  @id @default(uuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  email     String
  isPrimary Boolean @default(false)

  @@index([contactId])
  @@map("contact_emails")
}

model ContactLookupOption {
  id         String            @id @default(uuid())
  businessId String
  business   Business          @relation(fields: [businessId], references: [id], onDelete: Cascade)
  kind       ContactLookupKind
  value      String

  createdAt DateTime @default(now())

  @@unique([businessId, kind, value])
  @@index([businessId, kind])
  @@map("contact_lookup_options")
}
```

In the `Business` model, find the relation-list block (`contacts BusinessContact[]`, `userBusinesses UserBusiness[]`, `refreshTokens RefreshToken[]`) and add a new line right after `contacts BusinessContact[]`:

```prisma
  contacts               BusinessContact[]
  contactLookupOptions   ContactLookupOption[]
  userBusinesses         UserBusiness[]
```

In the `Organization` model, delete this line:

```prisma
  contacts OrganizationContact[]
```

Delete the entire `model OrganizationContact { ... }` block.

In the `Vendor` model, delete this line:

```prisma
  contacts        VendorContact[]
```

Delete the entire `model VendorContact { ... }` block.

- [ ] **Step 2: Generate a migration scaffold without applying it**

```bash
pnpm --filter @bmp/database exec prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/unified-contacts-migration-draft.sql
```

This repo's `docker compose`-based Postgres is shared across git worktrees (documented in this repo's CLAUDE.md and re-confirmed during this session's own RFQ plan) — if you're working from a worktree, the raw diff may include unrelated drift from other branches' unmerged schema work. Hand-curate the output to include only statements touching `contacts`, `contact_phones`, `contact_emails`, `contact_lookup_options`, `organization_contacts`, `vendor_contacts`, `businesses` (the new relation is not itself a column, so no `businesses` table statement should actually appear), `ContactEntityType`, and `ContactLookupKind` — discard anything else the raw diff shows.

- [ ] **Step 3: Write the final migration file with the data-migration step reordered in**

Create `packages/database/prisma/migrations/<timestamp>_unified_contacts/migration.sql` (timestamp format: 14-digit UTC, e.g. `20260831090000`, matching this repo's existing migrations) with this exact content — the auto-generated `CREATE TYPE`/`CREATE TABLE` statements from Step 2 come first (reproduced below in the form Prisma generates them), then the hand-written data migration, then the `DROP TABLE` statements for the old tables:

```sql
-- CreateEnum
CREATE TYPE "ContactEntityType" AS ENUM ('ORGANIZATION', 'VENDOR');

-- CreateEnum
CREATE TYPE "ContactLookupKind" AS ENUM ('DEPARTMENT', 'DESIGNATION');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "entityType" "ContactEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "designation" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_phones" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_emails" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lookup_options" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "ContactLookupKind" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_lookup_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_entityType_entityId_idx" ON "contacts"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "contact_phones_contactId_idx" ON "contact_phones"("contactId");

-- CreateIndex
CREATE INDEX "contact_emails_contactId_idx" ON "contact_emails"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lookup_options_businessId_kind_value_key" ON "contact_lookup_options"("businessId", "kind", "value");

-- CreateIndex
CREATE INDEX "contact_lookup_options_businessId_kind_idx" ON "contact_lookup_options"("businessId", "kind");

-- AddForeignKey
ALTER TABLE "contact_phones" ADD CONSTRAINT "contact_phones_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lookup_options" ADD CONSTRAINT "contact_lookup_options_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: move existing organization_contacts/vendor_contacts rows into the new
-- unified Contact model before dropping the old tables. A temp table maps each old row's id
-- to a freshly generated Contact id, kept stable across the three INSERT statements that need
-- it (a bare `gen_random_uuid()` repeated across separate statements would generate different
-- values each time).
CREATE TEMP TABLE org_contact_id_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id FROM organization_contacts;

INSERT INTO contacts (id, "entityType", "entityId", name, department, designation, notes, "isPrimary", "createdAt", "updatedAt")
SELECT m.new_id, 'ORGANIZATION', oc."organizationId", oc.name, NULL, oc.designation, NULL, oc."isPrimary", oc."createdAt", oc."updatedAt"
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id;

INSERT INTO contact_phones (id, "contactId", phone, "isPrimary")
SELECT gen_random_uuid(), m.new_id, oc.phone, true
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id
WHERE oc.phone IS NOT NULL AND oc.phone <> '';

INSERT INTO contact_emails (id, "contactId", email, "isPrimary")
SELECT gen_random_uuid(), m.new_id, oc.email, true
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id
WHERE oc.email IS NOT NULL AND oc.email <> '';

DROP TABLE org_contact_id_map;

CREATE TEMP TABLE vendor_contact_id_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id FROM vendor_contacts;

INSERT INTO contacts (id, "entityType", "entityId", name, department, designation, notes, "isPrimary", "createdAt", "updatedAt")
SELECT m.new_id, 'VENDOR', vc."vendorId", vc.name, NULL, vc.designation, NULL, vc."isPrimary", vc."createdAt", vc."updatedAt"
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id;

INSERT INTO contact_phones (id, "contactId", phone, "isPrimary")
SELECT gen_random_uuid(), m.new_id, vc.phone, true
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id
WHERE vc.phone IS NOT NULL AND vc.phone <> '';

INSERT INTO contact_emails (id, "contactId", email, "isPrimary")
SELECT gen_random_uuid(), m.new_id, vc.email, true
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id
WHERE vc.email IS NOT NULL AND vc.email <> '';

DROP TABLE vendor_contact_id_map;

-- DropTable
DROP TABLE "organization_contacts";

-- DropTable
DROP TABLE "vendor_contacts";
```

If Step 2's real diff output disagrees with any exact constraint/index name shown above (Prisma's naming is deterministic from the schema but worth a direct comparison), use the real generated names instead — the statements' *content and ordering* (enums/tables/indexes/FKs first, then the data migration, then the two old-table drops last) is what matters, not that these exact literal name strings are reproduced byte-for-byte.

- [ ] **Step 4: Insert a pre-migration fixture to prove the data migration works**

Before applying, seed one synthetic row in each old table using the schema as it exists right now (pre-migration):

```bash
docker compose exec -T postgres psql -U bmp -d bmp -c "
INSERT INTO organizations (id, name, type, \"createdById\") VALUES ('11111111-1111-1111-1111-111111111111', 'Migration Fixture Org', 'PRIVATE', (SELECT id FROM users LIMIT 1)) ON CONFLICT DO NOTHING;
INSERT INTO organization_contacts (id, \"organizationId\", name, designation, email, phone, \"isPrimary\", \"createdAt\", \"updatedAt\") VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Fixture Contact', 'Manager', 'fixture@example.com', '9999999999', true, now(), now()) ON CONFLICT DO NOTHING;
"
```

- [ ] **Step 5: Apply the migration and regenerate the client**

```bash
pnpm --filter @bmp/database exec prisma migrate deploy
pnpm db:generate
```

- [ ] **Step 6: Verify the fixture migrated correctly, then clean up**

```bash
docker compose exec -T postgres psql -U bmp -d bmp -t -c "
select c.name, c.designation, c.department, c.\"isPrimary\", cp.phone, ce.email
from contacts c
left join contact_phones cp on cp.\"contactId\" = c.id
left join contact_emails ce on ce.\"contactId\" = c.id
where c.\"entityId\" = '11111111-1111-1111-1111-111111111111';
"
```

Expected: one row — `Fixture Contact | Manager | (empty) | t | 9999999999 | fixture@example.com`. Then clean up:

```bash
docker compose exec -T postgres psql -U bmp -d bmp -c "
DELETE FROM contact_emails WHERE email = 'fixture@example.com';
DELETE FROM contact_phones WHERE phone = '9999999999';
DELETE FROM contacts WHERE \"entityId\" = '11111111-1111-1111-1111-111111111111';
DELETE FROM organizations WHERE id = '11111111-1111-1111-1111-111111111111';
"
```

Also confirm the old tables are genuinely gone:

```bash
docker compose exec -T postgres psql -U bmp -d bmp -t -c "select to_regclass('organization_contacts'), to_regclass('vendor_contacts');"
```

Expected: two empty/null results.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations/
git commit -m "feat(database): add unified Contact model, drop OrganizationContact/VendorContact"
```

---

### Task 2: Shared `@bmp/types` — `contact.ts`, update `organization.ts`/`vendor.ts`

**Files:**
- Create: `packages/types/src/contact.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/organization.ts`
- Modify: `packages/types/src/vendor.ts`

**Interfaces:**
- Produces: `ContactDto`, `ContactPhoneDto`, `ContactEmailDto`, `CreateContactInput`, `UpdateContactInput`, `CONTACT_LOOKUP_KINDS`, `ContactLookupKind`, `ContactLookupOptionsDto`.

- [ ] **Step 1: Create `packages/types/src/contact.ts`**

```typescript
export interface ContactPhoneDto {
  id: string;
  phone: string;
  isPrimary: boolean;
}

export interface ContactEmailDto {
  id: string;
  email: string;
  isPrimary: boolean;
}

export interface ContactDto {
  id: string;
  name: string;
  department: string | null;
  designation: string | null;
  notes: string | null;
  isPrimary: boolean;
  phones: ContactPhoneDto[];
  emails: ContactEmailDto[];
  createdAt: string;
}

export interface CreateContactPhoneInput {
  phone: string;
  isPrimary: boolean;
}

export interface CreateContactEmailInput {
  email: string;
  isPrimary: boolean;
}

export interface CreateContactInput {
  name: string;
  department?: string;
  designation?: string;
  notes?: string;
  isPrimary?: boolean;
  phones?: CreateContactPhoneInput[];
  emails?: CreateContactEmailInput[];
}

export type UpdateContactInput = Partial<CreateContactInput>;

export const CONTACT_LOOKUP_KINDS = ["DEPARTMENT", "DESIGNATION"] as const;
export type ContactLookupKind = (typeof CONTACT_LOOKUP_KINDS)[number];

export interface ContactLookupOptionsDto {
  kind: ContactLookupKind;
  values: string[];
}
```

- [ ] **Step 2: Add the barrel export**

In `packages/types/src/index.ts`, insert alphabetically between `category.js` and `finance.js`:

```typescript
export * from "./contact.js";
```

- [ ] **Step 3: Edit `packages/types/src/organization.ts`**

Delete the `OrganizationContactDto`, `CreateOrganizationContactInput`, and `UpdateOrganizationContactInput` type definitions entirely. Find `OrganizationDto`'s `contacts` field and change its type from `OrganizationContactDto[]` to `ContactDto[]`. Add the import at the top of the file:

```typescript
import type { ContactDto } from "./contact.js";
```

- [ ] **Step 4: Edit `packages/types/src/vendor.ts`**

Same as Step 3: delete `VendorContactDto`/`CreateVendorContactInput`/`UpdateVendorContactInput`, change `VendorDto`'s `contacts` field type to `ContactDto[]`, add `import type { ContactDto } from "./contact.js";`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @bmp/types typecheck
pnpm --filter @bmp/server typecheck
pnpm --filter @bmp/web typecheck
```

Expect errors in `apps/server`'s organizations/vendors modules and `apps/web`'s contact dialogs/hooks — these are fixed by later tasks. Confirm the errors are confined to files this plan's remaining tasks own.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/contact.ts packages/types/src/index.ts packages/types/src/organization.ts packages/types/src/vendor.ts
git commit -m "feat(types): add shared Contact types, remove duplicated organization/vendor contact types"
```

---

### Task 3: Contacts repository + mapper (new backend module)

**Files:**
- Create: `apps/server/src/modules/contacts/contacts.repository.ts`
- Create: `apps/server/src/modules/contacts/contacts.mapper.ts`
- Test: `apps/server/src/modules/contacts/__tests__/contacts.repository.integration.spec.ts`

**Interfaces:**
- Consumes: `Contact`/`ContactPhone`/`ContactEmail`/`ContactLookupOption` Prisma models from Task 1.
- Produces: `IContactsRepository` with `findByEntity`, `create`, `update`, `delete`, `belongsToEntity`, `listLookupOptions`, `upsertLookupOptionIfMissing`; `ContactWithChildren` type; `toContactDto(contact: ContactWithChildren): ContactDto`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContactsRepository } from "../contacts.repository.js";

describe("ContactsRepository (integration)", () => {
  let repository: ContactsRepository;
  let businessId: string;
  const entityId = randomUUID();

  beforeAll(async () => {
    repository = new ContactsRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Contacts Repo Test ${randomUUID()}`, code: `CRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { entityId } });
    await prisma.contactLookupOption.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("creates a contact with phones and emails, and unsets a prior primary contact for the same entity", async () => {
    const first = await repository.create({
      entityType: "ORGANIZATION",
      entityId,
      name: "Alice",
      isPrimary: true,
      phones: [{ phone: "1111111111", isPrimary: true }],
      emails: [{ email: "alice@example.com", isPrimary: true }],
    });
    expect(first.isPrimary).toBe(true);
    expect(first.phones).toHaveLength(1);
    expect(first.emails).toHaveLength(1);

    const second = await repository.create({
      entityType: "ORGANIZATION",
      entityId,
      name: "Bob",
      isPrimary: true,
    });
    expect(second.isPrimary).toBe(true);

    const refreshedFirst = await repository.findByEntity("ORGANIZATION", entityId);
    const alice = refreshedFirst.find((c) => c.name === "Alice")!;
    expect(alice.isPrimary).toBe(false);
  });

  it("fully replaces phones and emails on update", async () => {
    const contact = await repository.create({
      entityType: "VENDOR",
      entityId,
      name: "Carol",
      phones: [{ phone: "2222222222", isPrimary: true }],
    });

    const updated = await repository.update(contact.id, {
      phones: [
        { phone: "3333333333", isPrimary: true },
        { phone: "4444444444", isPrimary: false },
      ],
    });

    expect(updated.phones).toHaveLength(2);
    expect(updated.phones.map((p) => p.phone).sort()).toEqual(["3333333333", "4444444444"]);
  });

  it("upserts a lookup option only once for the same business/kind/value", async () => {
    await repository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", "Engineering");
    await repository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", "Engineering");
    const values = await repository.listLookupOptions(businessId, "DEPARTMENT");
    expect(values).toEqual(["Engineering"]);
  });

  it("confirms whether a contact belongs to the given entity", async () => {
    const contact = await repository.create({ entityType: "ORGANIZATION", entityId, name: "Dana" });
    expect(await repository.belongsToEntity(contact.id, "ORGANIZATION", entityId)).toBe(true);
    expect(await repository.belongsToEntity(contact.id, "VENDOR", entityId)).toBe(false);
    expect(await repository.belongsToEntity(randomUUID(), "ORGANIZATION", entityId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/contacts/__tests__/contacts.repository.integration.spec.ts
```

Expected: fails to even import — the module doesn't exist yet.

- [ ] **Step 3: Implement `contacts.repository.ts`**

```typescript
import { randomUUID } from "node:crypto";

import type { ContactEntityType, ContactLookupKind, Prisma, PrismaClient } from "@bmp/database";

const contactWithChildren = {
  include: {
    phones: { orderBy: { isPrimary: "desc" } },
    emails: { orderBy: { isPrimary: "desc" } },
  },
} satisfies Prisma.ContactDefaultArgs;

export type ContactWithChildren = Prisma.ContactGetPayload<typeof contactWithChildren>;

export interface ContactPhoneInput {
  phone: string;
  isPrimary: boolean;
}

export interface ContactEmailInput {
  email: string;
  isPrimary: boolean;
}

export interface CreateContactData {
  entityType: ContactEntityType;
  entityId: string;
  name: string;
  department?: string | null;
  designation?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
  phones?: ContactPhoneInput[];
  emails?: ContactEmailInput[];
}

export type UpdateContactData = Partial<Omit<CreateContactData, "entityType" | "entityId">>;

export interface IContactsRepository {
  findByEntity(entityType: ContactEntityType, entityId: string): Promise<ContactWithChildren[]>;
  create(data: CreateContactData): Promise<ContactWithChildren>;
  update(id: string, data: UpdateContactData): Promise<ContactWithChildren>;
  delete(id: string): Promise<void>;
  belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean>;
  listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]>;
  upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string): Promise<void>;
}

export class ContactsRepository implements IContactsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByEntity(entityType: ContactEntityType, entityId: string): Promise<ContactWithChildren[]> {
    return this.prisma.contact.findMany({
      where: { entityType, entityId },
      orderBy: { isPrimary: "desc" },
      ...contactWithChildren,
    });
  }

  async create(data: CreateContactData): Promise<ContactWithChildren> {
    const { phones, emails, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      if (rest.isPrimary) {
        await tx.contact.updateMany({
          where: { entityType: rest.entityType, entityId: rest.entityId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contact.create({
        data: {
          id: randomUUID(),
          ...rest,
          phones: { create: (phones ?? []).map((p) => ({ id: randomUUID(), ...p })) },
          emails: { create: (emails ?? []).map((e) => ({ id: randomUUID(), ...e })) },
        },
        ...contactWithChildren,
      });
    });
  }

  async update(id: string, data: UpdateContactData): Promise<ContactWithChildren> {
    const { phones, emails, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findUniqueOrThrow({ where: { id } });
      if (rest.isPrimary) {
        await tx.contact.updateMany({
          where: {
            entityType: existing.entityType,
            entityId: existing.entityId,
            isPrimary: true,
            id: { not: id },
          },
          data: { isPrimary: false },
        });
      }
      if (phones !== undefined) {
        await tx.contactPhone.deleteMany({ where: { contactId: id } });
      }
      if (emails !== undefined) {
        await tx.contactEmail.deleteMany({ where: { contactId: id } });
      }
      return tx.contact.update({
        where: { id },
        data: {
          ...rest,
          ...(phones !== undefined
            ? { phones: { create: phones.map((p) => ({ id: randomUUID(), ...p })) } }
            : {}),
          ...(emails !== undefined
            ? { emails: { create: emails.map((e) => ({ id: randomUUID(), ...e })) } }
            : {}),
        },
        ...contactWithChildren,
      });
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contact.delete({ where: { id } });
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean> {
    const count = await this.prisma.contact.count({ where: { id: contactId, entityType, entityId } });
    return count > 0;
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]> {
    const rows = await this.prisma.contactLookupOption.findMany({
      where: { businessId, kind },
      orderBy: { value: "asc" },
      select: { value: true },
    });
    return rows.map((row) => row.value);
  }

  async upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string): Promise<void> {
    await this.prisma.contactLookupOption.upsert({
      where: { businessId_kind_value: { businessId, kind, value } },
      create: { id: randomUUID(), businessId, kind, value },
      update: {},
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/contacts/__tests__/contacts.repository.integration.spec.ts
```

If Prisma's generated compound-unique input key name for `@@unique([businessId, kind, value])` differs from `businessId_kind_value` (check `packages/database/generated/client/index.d.ts` for the real generated name if this step fails with a type error), use the real generated name instead.

- [ ] **Step 5: Create `contacts.mapper.ts`**

```typescript
import type { ContactDto } from "@bmp/types";

import type { ContactWithChildren } from "./contacts.repository.js";

export function toContactDto(contact: ContactWithChildren): ContactDto {
  return {
    id: contact.id,
    name: contact.name,
    department: contact.department,
    designation: contact.designation,
    notes: contact.notes,
    isPrimary: contact.isPrimary,
    phones: contact.phones.map((phone) => ({ id: phone.id, phone: phone.phone, isPrimary: phone.isPrimary })),
    emails: contact.emails.map((email) => ({ id: email.id, email: email.email, isPrimary: email.isPrimary })),
    createdAt: contact.createdAt.toISOString(),
  };
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/contacts/contacts.repository.ts apps/server/src/modules/contacts/contacts.mapper.ts apps/server/src/modules/contacts/__tests__/
git commit -m "feat(contacts): add repository and mapper for the unified Contact model"
```

---

### Task 4: Contacts service

**Files:**
- Create: `apps/server/src/modules/contacts/contacts.service.ts`
- Test: `apps/server/src/modules/contacts/__tests__/contacts.service.spec.ts`

**Interfaces:**
- Consumes: `IContactsRepository` from Task 3.
- Produces: `ContactsService` with `listContacts(entityType, entityId): Promise<ContactDto[]>`, `createContact(entityType, entityId, data, businessId): Promise<void>`, `updateContact(contactId, data, businessId): Promise<void>`, `deleteContact(contactId): Promise<void>`, `belongsToEntity(contactId, entityType, entityId): Promise<boolean>`, `listLookupOptions(businessId, kind): Promise<string[]>`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  ContactEntityType,
  ContactLookupKind,
  ContactWithChildren,
  CreateContactData,
  IContactsRepository,
  UpdateContactData,
} from "../contacts.repository.js";
import { ContactsService } from "../contacts.service.js";

class FakeContactsRepository implements IContactsRepository {
  contacts = new Map<string, ContactWithChildren>();
  lookupOptions = new Map<string, Set<string>>();

  async findByEntity(entityType: ContactEntityType, entityId: string) {
    return [...this.contacts.values()].filter(
      (c) => c.entityType === entityType && c.entityId === entityId,
    );
  }

  async create(data: CreateContactData) {
    if (data.isPrimary) {
      for (const c of this.contacts.values()) {
        if (c.entityType === data.entityType && c.entityId === data.entityId) c.isPrimary = false;
      }
    }
    const contact = {
      id: randomUUID(),
      entityType: data.entityType,
      entityId: data.entityId,
      name: data.name,
      department: data.department ?? null,
      designation: data.designation ?? null,
      notes: data.notes ?? null,
      isPrimary: data.isPrimary ?? false,
      phones: (data.phones ?? []).map((p) => ({ id: randomUUID(), contactId: "", ...p })),
      emails: (data.emails ?? []).map((e) => ({ id: randomUUID(), contactId: "", ...e })),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ContactWithChildren;
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async update(id: string, data: UpdateContactData) {
    const contact = this.contacts.get(id);
    if (!contact) throw new Error("not found");
    if (data.isPrimary) {
      for (const c of this.contacts.values()) {
        if (c.id !== id && c.entityType === contact.entityType && c.entityId === contact.entityId) {
          c.isPrimary = false;
        }
      }
    }
    Object.assign(contact, data);
    return contact;
  }

  async delete(id: string) {
    this.contacts.delete(id);
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string) {
    const contact = this.contacts.get(contactId);
    return Boolean(contact && contact.entityType === entityType && contact.entityId === entityId);
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind) {
    return [...(this.lookupOptions.get(`${businessId}:${kind}`) ?? new Set<string>())];
  }

  async upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string) {
    const key = `${businessId}:${kind}`;
    const set = this.lookupOptions.get(key) ?? new Set<string>();
    set.add(value);
    this.lookupOptions.set(key, set);
  }
}

describe("ContactsService", () => {
  let repository: FakeContactsRepository;
  let service: ContactsService;
  const businessId = randomUUID();
  const entityId = randomUUID();

  beforeEach(() => {
    repository = new FakeContactsRepository();
    service = new ContactsService(repository);
  });

  it("registers a new department value when creating a contact", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Alice", department: "Engineering" }, businessId);
    const values = await service.listLookupOptions(businessId, "DEPARTMENT");
    expect(values).toEqual(["Engineering"]);
  });

  it("does not register an empty department/designation", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Bob" }, businessId);
    expect(await service.listLookupOptions(businessId, "DEPARTMENT")).toEqual([]);
    expect(await service.listLookupOptions(businessId, "DESIGNATION")).toEqual([]);
  });

  it("registers a new designation value when updating a contact", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Carol" }, businessId);
    const [contact] = await service.listContacts("ORGANIZATION", entityId);
    await service.updateContact(contact!.id, { designation: "Site Manager" }, businessId);
    expect(await service.listLookupOptions(businessId, "DESIGNATION")).toEqual(["Site Manager"]);
  });

  it("reports whether a contact belongs to the given entity", async () => {
    await service.createContact("VENDOR", entityId, { name: "Dana" }, businessId);
    const [contact] = await service.listContacts("VENDOR", entityId);
    expect(await service.belongsToEntity(contact!.id, "VENDOR", entityId)).toBe(true);
    expect(await service.belongsToEntity(contact!.id, "ORGANIZATION", entityId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/contacts/__tests__/contacts.service.spec.ts
```

- [ ] **Step 3: Implement `contacts.service.ts`**

```typescript
import type { ContactDto } from "@bmp/types";

import type {
  ContactEntityType,
  ContactLookupKind,
  CreateContactData,
  IContactsRepository,
  UpdateContactData,
} from "./contacts.repository.js";
import { toContactDto } from "./contacts.mapper.js";

export class ContactsService {
  constructor(private readonly contactsRepository: IContactsRepository) {}

  async listContacts(entityType: ContactEntityType, entityId: string): Promise<ContactDto[]> {
    const contacts = await this.contactsRepository.findByEntity(entityType, entityId);
    return contacts.map(toContactDto);
  }

  async createContact(
    entityType: ContactEntityType,
    entityId: string,
    data: Omit<CreateContactData, "entityType" | "entityId">,
    businessId: string,
  ): Promise<void> {
    await this.registerLookupOptions(businessId, data.department, data.designation);
    await this.contactsRepository.create({ entityType, entityId, ...data });
  }

  async updateContact(contactId: string, data: UpdateContactData, businessId: string): Promise<void> {
    await this.registerLookupOptions(businessId, data.department, data.designation);
    await this.contactsRepository.update(contactId, data);
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.contactsRepository.delete(contactId);
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean> {
    return this.contactsRepository.belongsToEntity(contactId, entityType, entityId);
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]> {
    return this.contactsRepository.listLookupOptions(businessId, kind);
  }

  private async registerLookupOptions(
    businessId: string,
    department: string | null | undefined,
    designation: string | null | undefined,
  ): Promise<void> {
    if (department) {
      await this.contactsRepository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", department);
    }
    if (designation) {
      await this.contactsRepository.upsertLookupOptionIfMissing(businessId, "DESIGNATION", designation);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/contacts/__tests__/contacts.service.spec.ts
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/contacts/contacts.service.ts apps/server/src/modules/contacts/__tests__/contacts.service.spec.ts
git commit -m "feat(contacts): add ContactsService with lookup-option auto-registration"
```

---

### Task 5: Contacts module composition root + lookup-options endpoint

**Files:**
- Create: `apps/server/src/modules/contacts/contacts.validation.ts`
- Create: `apps/server/src/modules/contacts/contacts.controller.ts`
- Create: `apps/server/src/modules/contacts/contacts.routes.ts`
- Create: `apps/server/src/modules/contacts/contacts.module.ts`
- Modify: `apps/server/src/routes/v1.router.ts`

**Interfaces:**
- Consumes: `ContactsService` from Task 4.
- Produces: `GET /contacts/lookup-options?kind=DEPARTMENT|DESIGNATION`, exported `contactsRepository`/`contactsService` singletons for Tasks 6/7 to import.

- [ ] **Step 1: Create `contacts.validation.ts`**

```typescript
import { z } from "zod";

export const listLookupOptionsQuerySchema = z.object({
  kind: z.enum(["DEPARTMENT", "DESIGNATION"]),
});
export type ListLookupOptionsQuery = z.infer<typeof listLookupOptionsQuerySchema>;

export const contactPhoneSchema = z.object({
  phone: z.string().min(1, "Required").max(30),
  isPrimary: z.boolean(),
});

export const contactEmailSchema = z.object({
  email: z.string().email("Invalid email"),
  isPrimary: z.boolean(),
});

function atMostOnePrimary(items: { isPrimary: boolean }[] | undefined): boolean {
  if (!items) return true;
  return items.filter((item) => item.isPrimary).length <= 1;
}

export const createContactSchema = z.object({
  name: z.string().min(1, "Required").max(150),
  department: z.string().max(150).optional(),
  designation: z.string().max(150).optional(),
  notes: z.string().max(2000).optional(),
  isPrimary: z.boolean().optional(),
  phones: z.array(contactPhoneSchema).max(10).optional(),
  emails: z.array(contactEmailSchema).max(10).optional(),
}).refine((data) => atMostOnePrimary(data.phones), {
  message: "At most one phone number can be marked primary",
  path: ["phones"],
}).refine((data) => atMostOnePrimary(data.emails), {
  message: "At most one email can be marked primary",
  path: ["emails"],
});
export type CreateContactBody = z.infer<typeof createContactSchema>;

export const updateContactSchema = z.object({
  name: z.string().min(1, "Required").max(150).optional(),
  department: z.string().max(150).optional(),
  designation: z.string().max(150).optional(),
  notes: z.string().max(2000).optional(),
  isPrimary: z.boolean().optional(),
  phones: z.array(contactPhoneSchema).max(10).optional(),
  emails: z.array(contactEmailSchema).max(10).optional(),
}).refine((data) => atMostOnePrimary(data.phones), {
  message: "At most one phone number can be marked primary",
  path: ["phones"],
}).refine((data) => atMostOnePrimary(data.emails), {
  message: "At most one email can be marked primary",
  path: ["emails"],
});
export type UpdateContactBody = z.infer<typeof updateContactSchema>;
```

`updateContactSchema` is written out directly (not `createContactSchema.partial()`) because `.refine()` on a `ZodObject` returns a `ZodEffects` wrapper that doesn't expose `.partial()` — this is the same reason to hand-write it rather than derive it.

- [ ] **Step 2: Create `contacts.controller.ts`**

```typescript
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { ContactsService } from "./contacts.service.js";
import type { ListLookupOptionsQuery } from "./contacts.validation.js";

export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  listLookupOptions = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListLookupOptionsQuery;
    const values = await this.contactsService.listLookupOptions(req.user!.businessId, query.kind);
    sendSuccess(res, { kind: query.kind, values });
  });
}
```

- [ ] **Step 3: Create `contacts.routes.ts`**

```typescript
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { ContactsController } from "./contacts.controller.js";
import { listLookupOptionsQuerySchema } from "./contacts.validation.js";

export function createContactsRouter(controller: ContactsController): Router {
  const router = Router();

  /**
   * @openapi
   * /contacts/lookup-options:
   *   get:
   *     tags: [Contacts]
   *     summary: List a business's saved department/designation values for autocomplete
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: query
   *         name: kind
   *         required: true
   *         schema: { type: string, enum: [DEPARTMENT, DESIGNATION] }
   *     responses:
   *       200: { description: Lookup option values for the given kind }
   */
  router.get(
    "/lookup-options",
    authenticateMiddleware,
    validate(listLookupOptionsQuerySchema, "query"),
    controller.listLookupOptions,
  );

  return router;
}
```

- [ ] **Step 4: Create `contacts.module.ts`**

```typescript
import { prisma } from "../../infra/prisma/client.js";

import { ContactsController } from "./contacts.controller.js";
import { ContactsRepository } from "./contacts.repository.js";
import { createContactsRouter } from "./contacts.routes.js";
import { ContactsService } from "./contacts.service.js";

export const contactsRepository = new ContactsRepository(prisma);
export const contactsService = new ContactsService(contactsRepository);
const contactsController = new ContactsController(contactsService);

export const contactsRouter = createContactsRouter(contactsController);
```

- [ ] **Step 5: Mount the router in `v1.router.ts`**

Add the import alphabetically after the `categoriesRouter` import:

```typescript
import { contactsRouter } from "../modules/contacts/contacts.module.js";
```

Add the mount line after `v1Router.use("/categories", categoriesRouter);`:

```typescript
v1Router.use("/contacts", contactsRouter);
```

- [ ] **Step 6: Manual verification (no automated test — this is a thin controller/route wiring task, matching this codebase's convention of not unit-testing pure pass-through controllers)**

```bash
pnpm --filter @bmp/server typecheck
```

Confirm no new errors in the files this task touches.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/contacts/contacts.validation.ts apps/server/src/modules/contacts/contacts.controller.ts apps/server/src/modules/contacts/contacts.routes.ts apps/server/src/modules/contacts/contacts.module.ts apps/server/src/routes/v1.router.ts
git commit -m "feat(contacts): add lookup-options endpoint and module composition root"
```

---

### Task 6: Wire Organizations to the Contacts module

**Files:**
- Modify: `apps/server/src/modules/organizations/organizations.repository.ts`
- Modify: `apps/server/src/modules/organizations/organizations.service.ts`
- Modify: `apps/server/src/modules/organizations/organizations.mapper.ts`
- Modify: `apps/server/src/modules/organizations/organizations.validation.ts`
- Modify: `apps/server/src/modules/organizations/organizations.controller.ts`
- Modify: `apps/server/src/modules/organizations/organizations.module.ts`
- Modify: `apps/server/src/modules/organizations/__tests__/organizations.service.spec.ts`

**Interfaces:**
- Consumes: `ContactsService`/`contactsService` singleton from Task 5, `ContactDto`/`CreateContactInput` from Task 2.
- Produces: `OrganizationsService.addContact(organizationId, data, actorId, businessId): Promise<OrganizationDto>` (businessId is a new required parameter), same signatures otherwise.

- [ ] **Step 1: Edit `organizations.repository.ts`**

Remove `contacts: { orderBy: { isPrimary: "desc" } }` from the `organizationWithContacts` include object and rename the const and its inferred type (since it no longer carries contacts):

```typescript
const organizationArgs = {
  include: { _count: { select: { tenders: true } } },
} satisfies Prisma.OrganizationDefaultArgs;

export type OrganizationEntity = Prisma.OrganizationGetPayload<typeof organizationArgs>;
```

Replace every other use of `organizationWithContacts`/`OrganizationWithContacts` in this file with `organizationArgs`/`OrganizationEntity`. Delete `CreateContactData`, `UpdateContactData`, and the `createContact`/`updateContact`/`deleteContact` methods and their three interface declarations from `IOrganizationsRepository` entirely — contact persistence now lives exclusively in the `contacts` module.

- [ ] **Step 2: Edit `organizations.mapper.ts`**

Delete the local `toContactDto` function entirely (the shared one now lives in `contacts.mapper.ts`). Change `toOrganizationDto` to accept contacts as a second parameter instead of reading `entity.contacts`:

```typescript
import type { ContactDto, OrganizationDto, OrganizationListItemDto } from "@bmp/types";

import type { OrganizationEntity } from "./organizations.repository.js";

export function toOrganizationListItemDto(entity: OrganizationEntity): OrganizationListItemDto {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    city: entity.city,
    state: entity.state,
    tenderCount: entity._count.tenders,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toOrganizationDto(entity: OrganizationEntity, contacts: ContactDto[]): OrganizationDto {
  return {
    ...toOrganizationListItemDto(entity),
    address: entity.address,
    pincode: entity.pincode,
    gstNumber: entity.gstNumber,
    website: entity.website,
    notes: entity.notes,
    contacts,
    updatedAt: entity.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 3: Edit `organizations.service.ts`**

Update imports: drop `CreateContactData`/`UpdateContactData` from the `organizations.repository.js` import, add `import { contactsService } from "../contacts/contacts.module.js";` is wrong for a constructor-injected dependency — instead add the type import `import type { ContactsService } from "../contacts/contacts.service.js";` and inject the real singleton via the constructor (wired in `organizations.module.ts`, Step 6 below). Update the constructor:

```typescript
  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly auditService: AuditService,
    private readonly contactsService: ContactsService,
  ) {}
```

Update `getById` to compose contacts from the new service:

```typescript
  async getById(id: string): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.findById(id);
    if (!organization) throw new NotFoundError("Organization not found");
    const contacts = await this.contactsService.listContacts("ORGANIZATION", id);
    return toOrganizationDto(organization, contacts);
  }
```

Update `create` (a brand-new organization always has zero contacts):

```typescript
  async create(data: CreateOrganizationData, context: RequestContext = {}): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.create(data);
    await this.auditService.log({
      actorId: data.createdById,
      action: "ORGANIZATION_CREATED",
      entityType: "Organization",
      entityId: organization.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toOrganizationDto(organization, []);
  }
```

Update `update` (find the existing method — it doesn't touch contacts, but must still return current ones):

```typescript
  async update(
    id: string,
    data: UpdateOrganizationData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<OrganizationDto> {
    const existing = await this.organizationsRepository.findById(id);
    if (!existing) throw new NotFoundError("Organization not found");
    const organization = await this.organizationsRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_UPDATED",
      entityType: "Organization",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    const contacts = await this.contactsService.listContacts("ORGANIZATION", id);
    return toOrganizationDto(organization, contacts);
  }
```

(Keep whatever the real current `update` method's audit-log action name/existing-check logic actually is — read the file first; the shape above is illustrative of the one required change, which is fetching and passing `contacts` at the end instead of relying on `organization.contacts`.)

Replace `assertContactBelongsToOrg`/`addContact`/`updateContact`/`deleteContact` with:

```typescript
  private async assertContactBelongsToOrg(organizationId: string, contactId: string): Promise<void> {
    const organization = await this.organizationsRepository.findById(organizationId);
    if (!organization) throw new NotFoundError("Organization not found");
    const belongs = await this.contactsService.belongsToEntity(contactId, "ORGANIZATION", organizationId);
    if (!belongs) throw new NotFoundError("Contact not found for this organization");
  }

  async addContact(
    organizationId: string,
    data: CreateContactInput,
    actorId: string,
    businessId: string,
  ): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.findById(organizationId);
    if (!organization) throw new NotFoundError("Organization not found");

    await this.contactsService.createContact("ORGANIZATION", organizationId, data, businessId);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_ADDED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }

  async updateContact(
    organizationId: string,
    contactId: string,
    data: UpdateContactInput,
    actorId: string,
    businessId: string,
  ): Promise<OrganizationDto> {
    await this.assertContactBelongsToOrg(organizationId, contactId);
    await this.contactsService.updateContact(contactId, data, businessId);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }

  async deleteContact(organizationId: string, contactId: string, actorId: string): Promise<OrganizationDto> {
    await this.assertContactBelongsToOrg(organizationId, contactId);
    await this.contactsService.deleteContact(contactId);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_DELETED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }
```

Add `import type { CreateContactInput, UpdateContactInput } from "@bmp/types";` to the top imports.

- [ ] **Step 4: Edit `organizations.validation.ts`**

Delete the local `createContactSchema`/`updateContactSchema`/`CreateContactBody`/`UpdateContactBody`. Import and re-export the shared ones so `organizations.routes.ts`/`organizations.controller.ts` don't need their own import-path changes:

```typescript
export {
  createContactSchema,
  updateContactSchema,
  type CreateContactBody,
  type UpdateContactBody,
} from "../contacts/contacts.validation.js";
```

- [ ] **Step 5: Edit `organizations.controller.ts`**

Update the three contact methods to pass `req.user!.businessId` through:

```typescript
  addContact = asyncHandler(async (req, res) => {
    const body = req.body as CreateContactBody;
    const organization = await this.organizationsService.addContact(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, organization, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const body = req.body as UpdateContactBody;
    const organization = await this.organizationsService.updateContact(
      req.params.id!,
      req.params.contactId!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, organization, "Contact updated");
  });
```

(`deleteContact` is unchanged — it never needed `businessId`.)

- [ ] **Step 6: Edit `organizations.module.ts`**

```typescript
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { contactsService } from "../contacts/contacts.module.js";

import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { createOrganizationsRouter } from "./organizations.routes.js";
import { OrganizationsService } from "./organizations.service.js";

const organizationsRepository = new OrganizationsRepository(prisma);
export const organizationsService = new OrganizationsService(organizationsRepository, auditService, contactsService);
const organizationsController = new OrganizationsController(organizationsService);

export const organizationsRouter = createOrganizationsRouter(organizationsController);
export { organizationsRepository };
```

- [ ] **Step 7: Update `organizations.service.spec.ts`**

Read the current file in full first (its `FakeOrganizationsRepository` currently embeds `contacts` directly on the fake org object, which no longer matches the real repository's shape). Update `buildOrg`/`FakeOrganizationsRepository` to drop `contacts` entirely and `createContact`/`updateContact`/`deleteContact` methods (removed from the interface in Step 1). Add a fake `ContactsService`-compatible double reusing the `FakeContactsRepository` pattern from Task 4's own test file (copy it into this file too — this codebase's convention is hand-written fakes per test file, not a shared fakes module) wrapped in a real `ContactsService` instance (reuse the real class against the fake repository — this is a legitimate "real service, fake repository" composition, same as how the RFQ plan's tests use real audit-service mocks alongside fake repositories):

```typescript
import { ContactsService } from "../../contacts/contacts.service.js";
// ...and the FakeContactsRepository class copied from contacts.service.spec.ts...
```

Update the `beforeEach` block:

```typescript
  beforeEach(() => {
    repository = new FakeOrganizationsRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    contactsRepository = new FakeContactsRepository();
    service = new OrganizationsService(repository, auditService, new ContactsService(contactsRepository));
  });
```

(Declare `let contactsRepository: FakeContactsRepository;` alongside the file's other `let` declarations.)

Update the "adds a contact to an organization" and "rejects updating a contact that belongs to a different organization" tests to pass a `businessId` argument:

```typescript
  it("adds a contact to an organization", async () => {
    const org = await repository.create({ name: "WithContact", type: "PRIVATE", createdById: actorId });
    const dto = await service.addContact(org.id, { name: "Jane Doe" }, actorId, randomUUID());
    expect(dto.contacts).toHaveLength(1);
    expect(dto.contacts[0]!.name).toBe("Jane Doe");
  });

  it("rejects updating a contact that belongs to a different organization", async () => {
    const orgA = await repository.create({ name: "OrgA", type: "PRIVATE", createdById: actorId });
    const orgB = await repository.create({ name: "OrgB", type: "PRIVATE", createdById: actorId });
    const businessId = randomUUID();
    await service.addContact(orgA.id, { name: "Contact A" }, actorId, businessId);
    const contacts = await service.getById(orgA.id);
    const contactId = contacts.contacts[0]!.id;

    await expect(
      service.updateContact(orgB.id, contactId, { name: "Hacked" }, actorId, businessId),
    ).rejects.toThrow(NotFoundError);
  });
```

- [ ] **Step 8: Run the tests**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/organizations
pnpm --filter @bmp/server typecheck
```

Fix anything the real file's current shape needs beyond what's shown above (e.g. if `update`'s exact existing audit-log action name differs from `"ORGANIZATION_UPDATED"`, keep the real one).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/organizations/
git commit -m "feat(organizations): delegate contact persistence to the shared Contacts module"
```

---

### Task 7: Wire Vendors to the Contacts module

**Files:**
- Modify: `apps/server/src/modules/vendors/vendors.repository.ts`
- Modify: `apps/server/src/modules/vendors/vendors.service.ts`
- Modify: `apps/server/src/modules/vendors/vendors.mapper.ts`
- Modify: `apps/server/src/modules/vendors/vendors.validation.ts`
- Modify: `apps/server/src/modules/vendors/vendors.controller.ts`
- Modify: `apps/server/src/modules/vendors/vendors.module.ts`
- Modify: `apps/server/src/modules/vendors/__tests__/vendors.service.spec.ts`

**Interfaces:**
- Consumes: same as Task 6, mirrored for Vendors.
- Produces: `VendorsService.addContact(vendorId, data, actorId, businessId): Promise<VendorDto>`.

- [ ] **Step 1: Edit `vendors.repository.ts`**

Same shape of change as Task 6 Step 1: remove `contacts: { orderBy: { isPrimary: "desc" } }` from `vendorWithContacts`'s include (keep `itemTags`/`ratings`/`_count` — this file's include object has more than just contacts, unlike organizations'), rename to `vendorArgs`/`VendorEntity`:

```typescript
const vendorArgs = {
  include: {
    itemTags: { orderBy: { createdAt: "desc" } },
    ratings: { select: { rating: true } },
    _count: { select: { ratings: true } },
  },
} satisfies Prisma.VendorDefaultArgs;

export type VendorEntity = Prisma.VendorGetPayload<typeof vendorArgs>;
```

Replace every other `vendorWithContacts`/`VendorWithContacts` reference in this file with `vendorArgs`/`VendorEntity`. Delete `CreateContactData`, `UpdateContactData`, and the `createContact`/`updateContact`/`deleteContact` methods and interface declarations from `IVendorsRepository`.

- [ ] **Step 2: Edit `vendors.mapper.ts`**

Delete the local `toContactDto`. Change whatever function builds `VendorDto` (confirm its real name — likely `toVendorDto`) to accept `contacts: ContactDto[]` as a parameter and use it directly instead of `entity.contacts.map(toContactDto)`.

- [ ] **Step 3: Edit `vendors.service.ts`**

Same shape of change as Task 6 Step 3: add `contactsService: ContactsService` as the new last constructor parameter; every place the service builds a `VendorDto` (its own `getById`/`create`/`update` equivalents — read the real file first) now fetches `await this.contactsService.listContacts("VENDOR", id)` and passes it to the mapper instead of relying on `entity.contacts`; `addContact`/`updateContact`/`deleteContact` delegate to `this.contactsService` the same way Task 6's did, with `businessId` threaded through `addContact`/`updateContact`.

- [ ] **Step 4: Edit `vendors.validation.ts`**

Same as Task 6 Step 4 — delete the local `createContactSchema`/`updateContactSchema`, re-export the shared ones from `../contacts/contacts.validation.js`.

- [ ] **Step 5: Edit `vendors.controller.ts`**

Same as Task 6 Step 5 — thread `req.user!.businessId` through `addContact`/`updateContact`.

- [ ] **Step 6: Edit `vendors.module.ts`**

```typescript
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { contactsService } from "../contacts/contacts.module.js";

import { VendorsController } from "./vendors.controller.js";
import { VendorsRepository } from "./vendors.repository.js";
import { createVendorsRouter } from "./vendors.routes.js";
import { VendorsService } from "./vendors.service.js";

const vendorsRepository = new VendorsRepository(prisma);
export const vendorsService = new VendorsService(vendorsRepository, auditService, contactsService);
const vendorsController = new VendorsController(vendorsService);

export const vendorsRouter = createVendorsRouter(vendorsController);
export { vendorsRepository };
```

(Verify the real current `VendorsService` constructor's exact existing parameter order before appending `contactsService` — Task 6's discovery process showed `VendorsRepository`'s file has more going on than `OrganizationsRepository`'s, e.g. `findRatings`/item-tag methods, but its own module wiring is the same two-arg `(vendorsRepository, auditService)` shape confirmed during this plan's research.)

- [ ] **Step 7: Update `vendors.service.spec.ts`**

Read the current file in full first, then apply the same category of changes as Task 6 Step 7: drop `contacts` from the fake's vendor-building helper and remove `createContact`/`updateContact`/`deleteContact` from `FakeVendorsRepository`; add a `FakeContactsRepository` (same class, copy from Task 4's test file) wired into a real `ContactsService` passed to `VendorsService`'s constructor; update any contact-related tests to pass a `businessId` argument.

- [ ] **Step 8: Run the tests**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/vendors
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/vendors/
git commit -m "feat(vendors): delegate contact persistence to the shared Contacts module"
```

---

### Task 8: Update `rfq.service.ts` for the new `emails[]` shape

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts`

**Interfaces:**
- Consumes: `ContactDto` (with `emails: ContactEmailDto[]`) now flowing through `VendorDto.contacts` from Task 7.

- [ ] **Step 1: Read the current file's exact `VendorWithContacts` import and usage**

`VendorWithContacts` was a Prisma-inferred type exported from `vendors.repository.ts` before Task 7's changes; Task 7 removed it (contacts are no longer part of that inferred type). Confirm what `rfq.service.ts` actually imports today (`import type { IVendorsRepository, VendorWithContacts } from "../vendors/vendors.repository.js";`) and update it to import `VendorDto` from `@bmp/types` instead, since `pickPrimaryContact` should operate on the already-composed DTO shape (fetched via `vendorsService`/`vendorsRepository.findById` + the vendors module's own contact composition), not a raw Prisma payload.

Check how `vendor` is obtained in `loadInviteVendorContext` (`this.vendorsRepository.findById(vendorId)`) — since `IVendorsRepository.findById` (per Task 7) no longer returns contacts inline, `rfq.service.ts` needs a different way to get a vendor's contacts. The cleanest fix: `RfqService` already has other cross-module dependencies (per this session's earlier RFQ plan) — add `vendorsService: VendorsService` as a new constructor dependency (importing `VendorsService`'s type and the `vendorsService` singleton from `vendors.module.ts`) and call `vendorsService.getById(vendorId)` instead of `vendorsRepository.findById(vendorId)` in `loadInviteVendorContext`, since `VendorsService.getById` is what composes contacts via `ContactsService` (Task 7).

- [ ] **Step 2: Edit `loadInviteVendorContext`/`pickPrimaryContact`**

```typescript
  private async loadInviteVendorContext(rfqId: string, vendorId: string, businessId: string) {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const vendor = await this.vendorsService.getById(vendorId);
    const contact = this.pickPrimaryContact(vendor);
    const primaryEmail = contact ? this.pickPrimaryEmail(contact) : undefined;
    if (!primaryEmail) {
      throw new BadRequestError("This vendor has no contact email on file — add one first");
    }
    return { rfq, vendor, contact, primaryEmail };
  }

  private pickPrimaryContact(vendor: VendorDto): VendorDto["contacts"][number] | undefined {
    return vendor.contacts.find((c) => c.isPrimary) ?? vendor.contacts[0];
  }

  private pickPrimaryEmail(contact: VendorDto["contacts"][number]): string | undefined {
    const primary = contact.emails.find((e) => e.isPrimary) ?? contact.emails[0];
    return primary?.email;
  }
```

Update the two downstream call sites (`previewInviteVendor`/`inviteVendor`) that currently do `contact.email!`:

```typescript
// previewInviteVendor:
const { rfq, primaryEmail } = await this.loadInviteVendorContext(rfqId, input.vendorId, businessId);
...
return { text, vendorContactEmail: primaryEmail };

// inviteVendor:
const { rfq, primaryEmail } = await this.loadInviteVendorContext(rfqId, input.vendorId, context.businessId);
...
await this.emailService.queueRfqEmail({ to: primaryEmail, rfqTitle: rfq.title, bodyText: input.text });
```

(`VendorsService.getById` throws `NotFoundError` if the vendor doesn't exist — check whether `loadInviteVendorContext`'s current `if (!vendor) throw new BadRequestError("Vendor not found");` guard is now redundant or needs to become a `try`/`catch` translating `NotFoundError` to the same `BadRequestError` message this codebase's tests already expect. Read the real current test file (`apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`) for the exact expected error before finalizing which approach to use.)

- [ ] **Step 3: Update `rfq.module.ts` to inject `vendorsService`**

Find wherever `RfqService` is constructed in `rfq.module.ts` and add `vendorsService` (imported from `../vendors/vendors.module.js`) as a new constructor argument, in whatever position matches the real current constructor's parameter list.

- [ ] **Step 4: Update `rfq.service.spec.ts`**

Read the current file's `FakeVendorsRepository` and `RfqService` construction. Since `RfqService` now depends on `VendorsService` (a real class) rather than calling `vendorsRepository.findById` directly, either: (a) construct a real `VendorsService` wrapping the existing `FakeVendorsRepository` plus a fake `AuditService`/`ContactsService` the same way Task 6/7's tests do, or (b) if that's too heavy for this file's existing test setup, inject a minimal hand-written fake matching `VendorsService`'s public shape (`{ getById: async (id) => ... }`) — pick whichever keeps this file's existing tests passing with the least structural change, since `rfq.service.spec.ts` predates this plan and its own scope is RFQ behavior, not vendor/contact behavior.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @bmp/server exec vitest run src/modules/rfq
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/rfq/rfq.service.ts apps/server/src/modules/rfq/rfq.module.ts apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts
git commit -m "fix(rfq): pick a vendor's primary email from the new contact emails array"
```

---

### Task 9: Backend regression checkpoint

**Files:** none (verification-only task).

- [ ] **Step 1: Dead-code check**

```bash
grep -rln "OrganizationContact\|VendorContact\|organizationWithContacts\|vendorWithContacts" apps/server/src packages/types/src
```

Every remaining hit should be a genuine, still-needed reference (there shouldn't be any — both models and their inferred-type consts are fully removed). Fix any real leftover found.

- [ ] **Step 2: Full server test suite**

```bash
docker compose exec -T redis redis-cli FLUSHALL
pnpm --filter @bmp/server exec vitest run
```

The only expected pre-existing failures are the shared-Redis login-rate-limiter cascade this repo's CLAUDE.md documents. Any organizations/vendors/rfq/contacts failure beyond that must be fixed before proceeding.

- [ ] **Step 3: Full server typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 4: No commit** — this task is a checkpoint, not a code change.

---

### Task 10: `Combobox` — new single-select, filterable, add-in-place component

**Files:**
- Create: `packages/ui/src/components/combobox.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `Combobox({ options: string[], value: string, onChange: (value: string) => void, placeholder?: string, className?: string })`.

- [ ] **Step 1: Create `combobox.tsx`**

```tsx
"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

export interface ComboboxProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function Combobox({ options, value, onChange, placeholder = "Select...", className }: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filteredOptions = React.useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) => option.toLowerCase().includes(needle));
  }, [options, query]);

  const trimmedQuery = query.trim();
  const hasExactMatch = options.some((option) => option.toLowerCase() === trimmedQuery.toLowerCase());
  const showAddOption = trimmedQuery.length > 0 && !hasExactMatch;

  function select(option: string) {
    onChange(option);
    setQuery("");
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[--radix-popover-trigger-width] min-w-[12rem] rounded-md border bg-popover p-0 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="border-b p-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search..."
              className="flex h-8 w-full rounded-sm border border-input bg-background px-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {showAddOption && (
              <div
                role="option"
                aria-selected={false}
                onClick={() => select(trimmedQuery)}
                className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-primary outline-none hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">Add &quot;{trimmedQuery}&quot;</span>
              </div>
            )}
            {filteredOptions.length === 0 && !showAddOption ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">No options found.</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option === value;
                return (
                  <div
                    key={option}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => select(option)}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <span className="flex-1 truncate">{option}</span>
                  </div>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
```

- [ ] **Step 2: Export it**

In `packages/ui/src/index.ts`, add (near `multi-select`, following the file's existing loosely-grouped-by-relation ordering):

```typescript
export * from "./components/combobox";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/ui typecheck
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/combobox.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add a single-select, filterable, add-in-place Combobox component"
```

---

### Task 11: `fuzzysort` dependency + `ContactSearchBar`

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/contacts/contact-search-bar.tsx`

**Interfaces:**
- Consumes: `ContactDto` from `@bmp/types`.
- Produces: `ContactSearchBar({ contacts: ContactDto[], onFilteredChange: (filtered: ContactDto[]) => void })`.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @bmp/web add fuzzysort
```

- [ ] **Step 2: Create `contact-search-bar.tsx`**

```tsx
"use client";

import type { ContactDto } from "@bmp/types";
import { Input } from "@bmp/ui";
import fuzzysort from "fuzzysort";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

export interface ContactSearchBarProps {
  contacts: ContactDto[];
  onFilteredChange: (filtered: ContactDto[]) => void;
}

interface SearchableContact {
  contact: ContactDto;
  name: string;
  department: string;
  designation: string;
}

export function ContactSearchBar({ contacts, onFilteredChange }: ContactSearchBarProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      onFilteredChange(contacts);
      return;
    }

    const searchable: SearchableContact[] = contacts.map((contact) => ({
      contact,
      name: contact.name,
      department: contact.department ?? "",
      designation: contact.designation ?? "",
    }));

    const results = fuzzysort.go(query, searchable, {
      keys: ["name", "department", "designation"],
      threshold: -10000,
    });

    onFilteredChange(results.map((result) => result.obj.contact));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, contacts]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search contacts by name, department, or designation..."
        className="pl-9"
      />
    </div>
  );
}
```

`fuzzysort.go`'s exact option names (`keys`, `threshold`) should be double-checked against the installed package version's actual TypeScript types once it's added in Step 1 — if `threshold` or the multi-key `keys` option name differs from what's shown here, adjust to match the real API (fuzzysort's `go()` function searches an array of objects by one or more string-valued keys and returns ranked results; the exact option surface has changed across major versions).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/contacts/contact-search-bar.tsx
git commit -m "feat(web): add fuzzysort dependency and a contact search bar"
```

---

### Task 12: `ContactCard`

**Files:**
- Create: `apps/web/src/components/contacts/contact-card.tsx`

**Interfaces:**
- Consumes: `ContactDto` from `@bmp/types`.
- Produces: `ContactCard({ contact: ContactDto, canUpdate: boolean, editTrigger: ReactNode, onDelete: () => void })`. `editTrigger` is a slot (not a bare callback) because opening the edit dialog needs a `ContactDialog` pre-filled with this specific contact — the caller (Tasks 15/16) supplies that whole `<ContactDialog trigger={...} .../>` element, and `ContactCard` just places it in its own header row next to the delete button, both gated behind the same `canUpdate` flag.

- [ ] **Step 1: Create `contact-card.tsx`**

```tsx
"use client";

import type { ContactDto } from "@bmp/types";
import { Badge, Button, Card, CardContent } from "@bmp/ui";
import { Mail, Phone, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

export interface ContactCardProps {
  contact: ContactDto;
  canUpdate: boolean;
  editTrigger: ReactNode;
  onDelete: () => void;
}

export function ContactCard({ contact, canUpdate, editTrigger, onDelete }: ContactCardProps) {
  const primaryPhone = contact.phones.find((p) => p.isPrimary) ?? contact.phones[0];
  const otherPhones = contact.phones.filter((p) => p.phone !== primaryPhone?.phone);
  const primaryEmail = contact.emails.find((e) => e.isPrimary) ?? contact.emails[0];
  const otherEmails = contact.emails.filter((e) => e.email !== primaryEmail?.email);

  return (
    <Card className="w-full">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <p className="text-lg font-medium">{contact.name}</p>
            {contact.isPrimary && <Badge variant="secondary">Primary</Badge>}
          </div>
          {canUpdate && (
            <div className="flex shrink-0 gap-2">
              {editTrigger}
              <Button size="sm" variant="ghost" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {(contact.designation ?? contact.department) && (
          <p className="text-sm text-muted-foreground">
            {[contact.designation, contact.department].filter(Boolean).join(" · ")}
          </p>
        )}

        {primaryPhone && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{primaryPhone.phone}</span>
            {otherPhones.map((phone) => (
              <span key={phone.id} className="text-muted-foreground">
                · {phone.phone}
              </span>
            ))}
          </div>
        )}

        {primaryEmail && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <a href={`mailto:${primaryEmail.email}`} className="font-medium text-primary hover:underline">
              {primaryEmail.email}
            </a>
            {otherEmails.map((email) => (
              <a key={email.id} href={`mailto:${email.email}`} className="text-muted-foreground hover:underline">
                · {email.email}
              </a>
            ))}
          </div>
        )}

        {contact.notes && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">Notes</p>
            <p className="whitespace-pre-wrap text-sm">{contact.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

The `mailto:` links here satisfy this same conversation's separate "clickable emails" request specifically for contact emails — the app-wide sweep across every other place an email appears is a separate, later spec/plan, not expanded here.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/contacts/contact-card.tsx
git commit -m "feat(web): add the redesigned ContactCard component"
```

---

### Task 13: `ContactDialog`

**Files:**
- Create: `apps/web/src/components/contacts/contact-dialog.tsx`
- Delete: `apps/web/src/components/organizations/contact-dialog.tsx`
- Delete: `apps/web/src/components/vendors/contact-dialog.tsx`

**Interfaces:**
- Consumes: `ContactDto`/`CreateContactInput` from `@bmp/types`, `Combobox` from `@bmp/ui` (Task 10).
- Produces: `ContactDialog({ trigger, contact?, departmentOptions, designationOptions, onSubmit })`.

- [ ] **Step 1: Create `contact-dialog.tsx`**

```tsx
"use client";

import type { ContactDto, CreateContactInput } from "@bmp/types";
import {
  Button,
  Checkbox,
  Combobox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

interface PhoneRow {
  key: string;
  phone: string;
  isPrimary: boolean;
}

interface EmailRow {
  key: string;
  email: string;
  isPrimary: boolean;
}

export interface ContactDialogProps {
  trigger: ReactNode;
  contact?: ContactDto;
  departmentOptions: string[];
  designationOptions: string[];
  onSubmit: (values: CreateContactInput) => Promise<void>;
}

function phonesToRows(phones: ContactDto["phones"]): PhoneRow[] {
  return phones.map((phone) => ({ key: phone.id, phone: phone.phone, isPrimary: phone.isPrimary }));
}

function emailsToRows(emails: ContactDto["emails"]): EmailRow[] {
  return emails.map((email) => ({ key: email.id, email: email.email, isPrimary: email.isPrimary }));
}

export function ContactDialog({
  trigger,
  contact,
  departmentOptions,
  designationOptions,
  onSubmit,
}: ContactDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(contact?.name ?? "");
  const [department, setDepartment] = useState(contact?.department ?? "");
  const [designation, setDesignation] = useState(contact?.designation ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [phones, setPhones] = useState<PhoneRow[]>(contact ? phonesToRows(contact.phones) : []);
  const [emails, setEmails] = useState<EmailRow[]>(contact ? emailsToRows(contact.emails) : []);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? "");
      setDepartment(contact?.department ?? "");
      setDesignation(contact?.designation ?? "");
      setNotes(contact?.notes ?? "");
      setIsPrimary(contact?.isPrimary ?? false);
      setPhones(contact ? phonesToRows(contact.phones) : []);
      setEmails(contact ? emailsToRows(contact.emails) : []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function addPhone() {
    setPhones((rows) => [...rows, { key: crypto.randomUUID(), phone: "", isPrimary: rows.length === 0 }]);
  }
  function addEmail() {
    setEmails((rows) => [...rows, { key: crypto.randomUUID(), email: "", isPrimary: rows.length === 0 }]);
  }
  function setPrimaryPhone(key: string) {
    setPhones((rows) => rows.map((row) => ({ ...row, isPrimary: row.key === key })));
  }
  function setPrimaryEmail(key: string) {
    setEmails((rows) => rows.map((row) => ({ ...row, isPrimary: row.key === key })));
  }

  async function handleSubmit() {
    const values: CreateContactInput = {
      name,
      department: department || undefined,
      designation: designation || undefined,
      notes: notes || undefined,
      isPrimary,
      phones: phones.filter((row) => row.phone.trim()).map((row) => ({ phone: row.phone, isPrimary: row.isPrimary })),
      emails: emails.filter((row) => row.email.trim()).map((row) => ({ email: row.email, isPrimary: row.isPrimary })),
    };
    await onSubmit(values);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Designation</label>
              <Combobox
                options={designationOptions}
                value={designation}
                onChange={setDesignation}
                placeholder="Select designation"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Department</label>
              <Combobox
                options={departmentOptions}
                value={department}
                onChange={setDepartment}
                placeholder="Select department"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Phone numbers</label>
              <Button type="button" size="sm" variant="outline" onClick={addPhone}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {phones.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="primary-phone"
                  checked={row.isPrimary}
                  onChange={() => setPrimaryPhone(row.key)}
                  title="Primary phone"
                />
                <Input
                  value={row.phone}
                  onChange={(e) =>
                    setPhones((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, phone: e.target.value } : r)),
                    )
                  }
                  placeholder="Phone number"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPhones((rows) => rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Emails</label>
              <Button type="button" size="sm" variant="outline" onClick={addEmail}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {emails.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="primary-email"
                  checked={row.isPrimary}
                  onChange={() => setPrimaryEmail(row.key)}
                  title="Primary email"
                />
                <Input
                  type="email"
                  value={row.email}
                  onChange={(e) =>
                    setEmails((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, email: e.target.value } : r)),
                    )
                  }
                  placeholder="Email address"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEmails((rows) => rows.filter((r) => r.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox checked={isPrimary} onCheckedChange={(checked) => setIsPrimary(Boolean(checked))} />
            <label className="text-sm">Primary contact</label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

This component uses plain `useState` rather than `react-hook-form`/`zod` (unlike the two dialogs it replaces) because its shape — two dynamic, independently-addable lists of rows, each with its own radio-style primary selector — doesn't map cleanly onto `react-hook-form`'s field-array API without materially more code for no real benefit here; validation (required name, at most one primary per list) is enforced server-side (Task 5) and is simple enough to also just check inline in `handleSubmit` if desired, though this plan doesn't require client-side pre-validation beyond what's shown, since a rejected request surfaces via this codebase's existing toast-on-error pattern at the call site (Tasks 15/16).

- [ ] **Step 2: Delete the two old dialogs**

```bash
git rm apps/web/src/components/organizations/contact-dialog.tsx apps/web/src/components/vendors/contact-dialog.tsx
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

Expect errors in `organizations/[id]/page.tsx`/`vendors/[id]/page.tsx` (they still import the deleted dialogs) — fixed in Tasks 15/16.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/contacts/contact-dialog.tsx
git commit -m "feat(web): add the shared ContactDialog, delete the two duplicated dialogs"
```

---

### Task 14: `use-contacts.ts` hook + update `use-organizations.ts`/`use-vendors.ts`

**Files:**
- Create: `apps/web/src/hooks/use-contacts.ts`
- Modify: `apps/web/src/hooks/use-organizations.ts`
- Modify: `apps/web/src/hooks/use-vendors.ts`

**Interfaces:**
- Produces: `useContactLookupOptions(kind: ContactLookupKind)`.
- Consumes/produces: `useAddOrganizationContact`/`useUpdateOrganizationContact`/`useDeleteOrganizationContact` (and vendor equivalents) keep their existing names/URLs, now typed against `CreateContactInput`/`ContactDto` from `@bmp/types`.

- [ ] **Step 1: Create `use-contacts.ts`**

```typescript
import type { ApiResponse, ContactLookupKind, ContactLookupOptionsDto } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { apiClient, unwrap } from "@/lib/axios";

export function useContactLookupOptions(kind: ContactLookupKind) {
  return useQuery({
    queryKey: ["contacts", "lookup-options", kind],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ContactLookupOptionsDto>>("/contacts/lookup-options", {
        params: { kind },
      });
      return unwrap(response.data);
    },
  });
}
```

Confirm the real import path for `apiClient`/`unwrap` (`@/lib/axios` vs `@/lib/api`) against the actual current `use-organizations.ts` before finalizing — this plan's earlier fact-gathering showed both `apiClient`/`unwrap` imported from `@/lib/axios` used by every hook file in this app; use whatever the real file shows.

- [ ] **Step 2: Update `use-organizations.ts`**

Change the import of `CreateOrganizationContactInput`/`UpdateOrganizationContactInput` to `CreateContactInput`/`UpdateContactInput` from `@bmp/types`, and update the three hooks' generic types accordingly (URLs/invalidation logic unchanged):

```typescript
export function useAddOrganizationContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateContactInput) => {
      const response = await apiClient.post<ApiResponse<OrganizationDto>>(
        `/organizations/${organizationId}/contacts`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
    },
  });
}

export function useUpdateOrganizationContact(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contactId, input }: { contactId: string; input: UpdateContactInput }) => {
      const response = await apiClient.patch<ApiResponse<OrganizationDto>>(
        `/organizations/${organizationId}/contacts/${contactId}`,
        input,
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", organizationId] });
    },
  });
}
```

(`useDeleteOrganizationContact` needs no type change — it already just takes a `contactId: string`.)

- [ ] **Step 3: Update `use-vendors.ts`**

Same change, mirrored for `useAddVendorContact`/`useUpdateVendorContact`.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-contacts.ts apps/web/src/hooks/use-organizations.ts apps/web/src/hooks/use-vendors.ts
git commit -m "feat(web): add lookup-options hook, retype contact hooks against the shared Contact types"
```

---

### Task 15: Wire the Organizations detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/organizations/[id]/page.tsx`

**Interfaces:**
- Consumes: `ContactCard`/`ContactDialog`/`ContactSearchBar` (Tasks 10-13), `useContactLookupOptions` (Task 14).

- [ ] **Step 1: Read the full current file**

Confirm the exact current imports, the `canUpdate` permission check, and the Contacts `Card`'s full current JSX before editing (already known from this plan's own research — re-read to catch any drift).

- [ ] **Step 2: Update imports**

Replace `import { ContactDialog } from "@/components/organizations/contact-dialog";` with:

```typescript
import { ContactCard } from "@/components/contacts/contact-card";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import { ContactSearchBar } from "@/components/contacts/contact-search-bar";
import { useContactLookupOptions } from "@/hooks/use-contacts";
```

- [ ] **Step 3: Add state and the lookup-option queries**

Near the component's other hook calls:

```typescript
  const [filteredContacts, setFilteredContacts] = useState(organization?.contacts ?? []);
  const departmentOptions = useContactLookupOptions("DEPARTMENT");
  const designationOptions = useContactLookupOptions("DESIGNATION");

  useEffect(() => {
    setFilteredContacts(organization?.contacts ?? []);
  }, [organization?.contacts]);
```

(Add `useEffect` to this file's existing `react` import if not already present.)

- [ ] **Step 4: Replace the Contacts `Card`'s content**

```tsx
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Contacts</CardTitle>
          {canUpdate && (
            <ContactDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="mr-2 h-4 w-4" /> Add contact
                </Button>
              }
              departmentOptions={departmentOptions.data?.values ?? []}
              designationOptions={designationOptions.data?.values ?? []}
              onSubmit={async (values) => {
                await addContact.mutateAsync(values);
                toast({ title: "Contact added" });
              }}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {organization.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts added yet.</p>
          ) : (
            <>
              <ContactSearchBar contacts={organization.contacts} onFilteredChange={setFilteredContacts} />
              {filteredContacts.length === 0 && (
                <p className="text-sm text-muted-foreground">No contacts match your search.</p>
              )}
              {filteredContacts.map((contact) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  canUpdate={canUpdate}
                  editTrigger={
                    <ContactDialog
                      contact={contact}
                      departmentOptions={departmentOptions.data?.values ?? []}
                      designationOptions={designationOptions.data?.values ?? []}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                      onSubmit={async (values) => {
                        await updateContact.mutateAsync({ contactId: contact.id, input: values });
                        toast({ title: "Contact updated" });
                      }}
                    />
                  }
                  onDelete={async () => {
                    await deleteContact.mutateAsync(contact.id);
                    toast({ title: "Contact removed" });
                  }}
                />
              ))}
            </>
          )}
        </CardContent>
      </Card>
```

`ContactCard` places `editTrigger` in its own header row next to its delete button (Task 12) — no wrapper `div`, no absolute positioning, no duplicate edit affordance. Confirm the `Pencil` icon is imported in this page file (it likely already was, for the pre-redesign dialog trigger — check before adding a duplicate import).

- [ ] **Step 5: Remove the page's own `max-w-3xl` wrapper on the Contacts card only if it visibly clips the redesigned card in Step 6's manual check** — otherwise leave the page's overall width constraint alone; the full app-wide width sweep is a separate, later spec/plan, not this task's job.

- [ ] **Step 6: Manual verification**

Start the dev server (or build+start, matching this session's own established pattern for testing a worktree), log in, navigate to an organization with at least one contact, and confirm: the redesigned card renders correctly, adding a contact with two phones/two emails and marking one of each primary works, the department/designation combobox's "Add" affordance creates and immediately selects a brand-new value, editing an existing contact pre-fills correctly, deleting removes it, and the search bar filters by a slightly-misspelled name/department/designation (fuzzy match).

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @bmp/web typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/organizations/\[id\]/page.tsx
git commit -m "feat(web): wire the redesigned contacts UI into the organization detail page"
```

---

### Task 16: Wire the Vendors detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/vendors/[id]/page.tsx`

**Interfaces:**
- Same as Task 15, mirrored for Vendors.

- [ ] **Step 1-8:** Repeat Task 15's steps exactly, substituting `vendor`/`vendorId`/`useAddVendorContact`/`useUpdateVendorContact`/`useDeleteVendorContact` for the organization equivalents, against `apps/web/src/app/(dashboard)/vendors/[id]/page.tsx`. Commit message: `"feat(web): wire the redesigned contacts UI into the vendor detail page"`.

---

### Task 17: Final checkpoint

**Files:** none (verification and dead-code check only).

- [ ] **Step 1: Dead-code check**

```bash
grep -rln "OrganizationContactDto\|VendorContactDto\|CreateOrganizationContactInput\|CreateVendorContactInput\|UpdateOrganizationContactInput\|UpdateVendorContactInput\|organizations/contact-dialog\|vendors/contact-dialog" apps/server/src apps/web/src packages/types/src
```

Every remaining hit should be nothing (empty result). Fix any real leftover found.

- [ ] **Step 2: Full server test suite**

```bash
docker compose exec -T redis redis-cli FLUSHALL
pnpm --filter @bmp/server exec vitest run
```

Compare against Task 9's baseline.

- [ ] **Step 3: Full web and server typecheck**

```bash
pnpm --filter @bmp/web typecheck
pnpm --filter @bmp/server typecheck
```

- [ ] **Step 4: Manual end-to-end smoke test in a running dev server**

1. Open an Organization with zero contacts — confirm "No contacts added yet" still shows, no search bar (nothing to search).
2. Add a contact with a brand-new department value via the combobox's "Add" option — confirm it's saved, then open the Add Contact dialog again and confirm that same value now appears as a normal, selectable option in the department combobox (proving the lookup list is genuinely being read back, not just accepted once).
3. Repeat steps 1-2 on a Vendor, confirming the exact same behavior — proving the shared module genuinely serves both.
4. Add two phone numbers to one contact, mark the second one primary, save, and confirm the card shows the second number as primary (bold/highlighted) and the first as a secondary listed number.
5. Confirm clicking a contact's primary email opens the system mail client (a `mailto:` link).
6. Search for a contact using a deliberately misspelled version of their name — confirm it still surfaces (fuzzy match working).
7. Delete a contact and confirm it disappears from both the list and the search results.

- [ ] **Step 5: No commit** — this task is a final checkpoint.
