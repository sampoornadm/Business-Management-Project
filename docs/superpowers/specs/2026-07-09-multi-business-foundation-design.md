# Multi-Business Foundation — Design

## Problem

BMP is currently single-tenant: one shared pool of tenders, projects, vendors, finance,
and users. The owner actually runs two separate businesses — **Archie Udyog** (tenders
arrive via Rediffmail) and **Samson Industries** (tenders arrive via Yahoo Mail) — and
needs their data (tenders, projects, BOQs, procurement, finance, reports) kept separate,
while still being able to see both as the owner, and without duplicating shared master
data like vendors and clients.

This is a prerequisite for a planned follow-on feature (email-based tender ingestion,
specced separately) that needs to know which business a given inbox belongs to. It's
being designed and built first because it's a cross-cutting foundation that the email
feature — and future features — depend on, not because it was the original ask.

The design should also generalize past exactly two businesses: the owner may productize
this platform for other companies later, so `Business` must be a real, admin-manageable
entity, not a hardcoded pair.

## Goals

- A `Business` entity (with registration/contact details: GST, Udyam, MSME, PAN,
  address, contacts) that scopes the operational data of the platform.
- Row-level data isolation: `businessId` added to Tender, Project, Boq, Rfq,
  PurchaseOrder, GoodsReceipt, BankAccount, Invoice, Expense, Payment. Attachments,
  AuditLog, and Notifications inherit scope implicitly through their parent entity —
  no new column needed on those.
- Vendors, Client Organizations, and the Historical Rate database stay shared/global
  across businesses (single list, no duplicate data entry) — only transactional
  records (POs, RFQs, tenders) scope to a business.
- Regular staff belong to exactly one business (enforced via login); the owner's
  account belongs to multiple, with an in-app switcher to set the active one.
- Permission *definitions* (the `resource:action` catalog) stay global; a user's role
  *assignment* becomes per-business, via a new `UserBusiness` join table.
- Per-business reports/metrics fall out of the same scoping automatically. A combined
  cross-business dashboard is explicit future work, structurally unblocked by this
  design but not built now.
- Defense-in-depth against the main risk of row-level multi-tenancy (a forgotten
  `businessId` filter leaking data across businesses): a Prisma Client extension that
  auto-injects the filter on scoped models.
- Schema and admin UI support creating additional businesses without code changes.

## Non-goals

- **Combined cross-business dashboard/reporting** — deferred. Nothing here blocks it
  (it's "drop the businessId filter, group by business" on the same tables later), but
  it isn't built in this phase.
- **Self-service tenant onboarding or billing** for productizing to other companies —
  explicitly deferred ("if I ever choose to ship it as a product").
- **Per-business branding/theming.**
- **Per-business permission catalogs** — the set of possible permissions stays global;
  only which role a user holds *in a given business* varies.
- **Migrating/backfilling existing data** — current tenders/projects/vendors are
  test/seed data and will be discarded, not migrated into the new model.
- **The email-based tender ingestion feature itself** — separate spec, depends on this
  one being in place (each mailbox will map to a `Business`).

## Design

### Data model

```
model Business {
  id                     String   @id @default(uuid())
  name                   String
  code                   String   @unique   // short slug, e.g. "ARCHIE", "SAMSON"
  address                String?
  city                   String?
  state                  String?
  pincode                String?
  gstNumber              String?
  udyamRegistrationNumber String?
  msmeCategory           String?  // MICRO | SMALL | MEDIUM
  panNumber              String?
  website                String?
  notes                  String?
  isActive               Boolean  @default(true)

  contacts        BusinessContact[]
  userBusinesses  UserBusiness[]
  // + one relation per scoped entity (tenders, projects, boqs, rfqs,
  //   purchaseOrders, goodsReceipts, bankAccounts, invoices, expenses, payments)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model BusinessContact {
  id          String   @id @default(uuid())
  businessId  String
  business    Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  name        String
  designation String?
  email       String?
  phone       String?
  isPrimary   Boolean  @default(false)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model UserBusiness {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@unique([userId, businessId])
}
```

- `businessId String` (required, indexed) added directly to: `Tender`, `Project`,
  `Boq`, `Rfq`, `PurchaseOrder`, `GoodsReceipt`, `BankAccount`, `Invoice`, `Expense`,
  `Payment`.
- `Vendor`, `Organization` (and their child tables), and `HistoricalRate` get **no**
  `businessId` — they stay global, mirroring today's behavior. `HistoricalRate` in
  particular has no enforced relation to `Tender` (`sourceTenderId` is an optional,
  unenforced `String` reference, not a Prisma `@relation`), so it already functions as
  a shared market-rate reference database rather than tender-owned data — treating it
  as global is a continuation of its current shape, not a new decision.
- `Role`/`Permission`/`RolePermission` are unchanged (still global catalog). `User`
  drops its single `roleId` FK; role is now per-`UserBusiness` row.

### Auth & session

- Login is unchanged (email/password). After authenticating, the server reads the
  user's `UserBusiness` rows. Exactly one → that business is set active automatically.
  More than one (the owner) → defaults to the last-used business (a stored preference);
  the switcher is always available regardless, so this is a convenience default, not a
  gate.
- Access and refresh JWTs both carry an `activeBusinessId` claim. Silent refresh
  (existing axios 401 auto-refresh flow) re-issues tokens with the *same*
  `activeBusinessId` — refreshing never changes the active business.
- **Switching business**: new `POST /auth/switch-business` endpoint. Validates the
  requested `businessId` has a matching `UserBusiness` row for the caller, then issues
  a fresh access+refresh pair with the new `activeBusinessId`. This is the only path
  that changes active business.
- `authenticateMiddleware` attaches `req.user.activeBusinessId` from the JWT.
  `requirePermission` resolves the caller's permission set from `UserBusiness.roleId`
  for their active business (not a single global role).

### Backend enforcement pattern

- Following this codebase's existing convention of threading an actor/context object
  through service methods (e.g. `tenders.service.ts`'s `create(data, context)` with
  `ipAddress`/`userAgent`), every scoped service method also receives `businessId` and
  passes it to repository calls as a `where: { businessId }` filter.
- **Defense in depth**: a Prisma Client extension auto-injects `businessId` into every
  query against a scoped model (via `$extends`, checking model name against a fixed
  scoped-model list), so a repository method that forgets the explicit filter still
  can't cross business lines. This is a safety net, not a replacement for explicit
  filtering — explicit filters stay for clarity and to keep query plans sane.

### Frontend

- **Business switcher**: dropdown in the topbar, visible only when the user has more
  than one `UserBusiness` row. Calling `/auth/switch-business` clears the TanStack
  Query cache entirely and refetches — simplest correct option, since nearly every
  cached query is business-scoped.
- **Auth store** (`apps/web/src/lib/auth-store.ts`) gains `activeBusinessId`, the list
  of businesses available to switch to, and the current role name for permission
  checks (since `hasPermission()` now depends on the active business, not a single
  global role).
- **New admin screen** ("Businesses"), permission-gated (e.g. `businesses:manage`,
  granted to the owner role): create/edit `Business` records and manage `UserBusiness`
  membership (which users belong to which business, with what role).

### Reporting

No new reporting work in this phase — the reporting module's existing queries pick up
the same `businessId` filter as every other scoped query, so per-business reports/
metrics fall out automatically. The combined cross-business dashboard is future work
(see Non-goals).

### Migration & seeding

- Since existing tenders/projects/vendors are test/seed data (confirmed disposable),
  the migration adds `Business`/`UserBusiness`/`BusinessContact` and adds `businessId`
  as `NOT NULL` directly on the scoped tables — no backfill script.
- Seed script creates two real `Business` rows (Archie Udyog, Samson Industries) as
  data, not hardcoded logic — adding a third later is a seed-data change only.
  `superadmin@bmp.local` gets a `UserBusiness` row for both (mirroring the owner
  account model); other seeded role-specific users (`tender.manager@`, `estimator@`,
  etc.) get assigned to one business each.

### Testing impact

- Unit tests' hand-written fake repositories (the `I<Name>Repository` fakes) need a
  `businessId` filter added to match real repository behavior.
- Integration tests (`*.integration.spec.ts`) need a test `Business` +
  `UserBusiness` fixture wired into their auth setup. This touches most existing
  integration test files across tenders/projects/finance/procurement modules — real
  effort to budget for in the implementation plan, not incidental cleanup.

## Open questions for implementation planning

- Exact list of scoped-model names for the Prisma Client extension (derive from the
  entity list above during planning, not guessed here).
