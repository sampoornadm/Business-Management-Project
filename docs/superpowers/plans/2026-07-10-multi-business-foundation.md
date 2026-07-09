# Multi-Business Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit BMP from single-tenant to row-level multi-business, so Archie Udyog and
Samson Industries (and any future business) have isolated tenders/projects/BOQs/procurement/
finance/reports, while a cross-business owner account can switch between them.

**Architecture:** A new `Business` entity + `UserBusiness` join table (per-business role
assignment) replaces the single global `User.roleId`. A required `businessId` column is added
to every operational entity (Tender, Project, Boq, Rfq, PurchaseOrder, GoodsReceipt,
BankAccount, Invoice, Expense, Payment, HistoricalRate). The JWT carries an `activeBusinessId`
claim set at login/switch time; every scoped repository call filters on it, backed by a Prisma
Client extension as a defense-in-depth safety net. Vendors and Client Organizations stay global.

**Tech Stack:** Express + TypeScript + Prisma + PostgreSQL (`apps/server`), Next.js + Zustand +
TanStack Query (`apps/web`), Vitest (hand-written fake repositories, no mocking framework).

## Global Constraints

- Vendors and Client Organizations (`Organization`) stay global/shared — no `businessId`.
- Permission *definitions* stay global; a user's role *assignment* becomes per-business via
  `UserBusiness`.
- Existing tenders/projects/vendors data is test/seed data — discard via `migrate:reset`, no
  backfill script.
- `Business` is a real, admin-manageable entity (not a hardcoded pair) so a third business can
  be added later without a code change.
- Regular staff belong to exactly one business; the owner's account belongs to multiple, with
  an active-business switcher (one business active at a time, not a combined view).
- Combined cross-business dashboard and cross-business historical-rate lookups are explicit
  future work — not built in this plan.
- Follow existing module structure exactly: `*.repository.ts` (thin Prisma wrapper + `I<Name>Repository`
  interface), `*.service.ts` (business logic, constructor-injected repos), `*.controller.ts`
  (`asyncHandler` + `sendSuccess`), `*.routes.ts` (`authenticateMiddleware` + `requirePermission`
  + `validate(zod)`), `*.module.ts` (composition root).
- Unit tests: Vitest with hand-written fake repositories implementing `I<Name>Repository` — no
  mocking framework. Integration tests: supertest against real Postgres (`bmp_test`).

---

## Phase A — Schema, shared types, and auth plumbing

### Task 1: Prisma schema — Business, BusinessContact, UserBusiness, and businessId scoping

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

**Interfaces:**
- Produces: `model Business`, `model BusinessContact`, `model UserBusiness` (fields: `id`,
  `userId`, `businessId`, `roleId`), `businessId String` column (+ `business` relation) on
  `Tender`, `Project`, `Boq`, `Rfq`, `PurchaseOrder`, `GoodsReceipt`, `BankAccount`, `Invoice`,
  `Expense`, `Payment`, `HistoricalRate`. `RefreshToken.activeBusinessId String`. `User` loses
  `roleId`/`role`; gains `userBusinesses UserBusiness[]`. `Role` loses `users User[]`; gains
  `userBusinesses UserBusiness[]`.

- [ ] **Step 1: Add `Business`, `BusinessContact`, `UserBusiness` models**

Insert immediately after `model RolePermission` (currently ends around line 113, right before
the `// Auth tokens` section comment) in `packages/database/prisma/schema.prisma`:

```prisma
// ---------------------------------------------------------------------------
// Businesses (tenants)
// ---------------------------------------------------------------------------

model Business {
  id                      String  @id @default(uuid())
  name                    String
  code                    String  @unique
  address                 String?
  city                    String?
  state                   String?
  pincode                 String?
  gstNumber               String?
  udyamRegistrationNumber String?
  msmeCategory            String?
  panNumber               String?
  website                 String?
  notes                   String?
  isActive                Boolean @default(true)

  contacts       BusinessContact[]
  userBusinesses UserBusiness[]
  refreshTokens  RefreshToken[]

  tenders         Tender[]
  projects        Project[]
  boqs            Boq[]
  historicalRates HistoricalRate[]
  rfqs            Rfq[]
  purchaseOrders  PurchaseOrder[]
  goodsReceipts   GoodsReceipt[]
  bankAccounts    BankAccount[]
  invoices        Invoice[]
  expenses        Expense[]
  payments        Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([name])
  @@map("businesses")
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

  @@index([businessId])
  @@map("business_contacts")
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
  @@index([businessId])
  @@index([roleId])
  @@map("user_businesses")
}
```

- [ ] **Step 2: Remove `User.roleId`/`role`, add `userBusinesses`**

In `model User` (lines 16-69), remove:

```prisma
  roleId String
  role   Role   @relation(fields: [roleId], references: [id], onDelete: Restrict)
```

and its index `@@index([roleId])`. Add in its place:

```prisma
  userBusinesses UserBusiness[]
```

- [ ] **Step 3: Update `model Role`**

In `model Role` (lines 71-84), replace:

```prisma
  users           User[]
  rolePermissions RolePermission[]
```

with:

```prisma
  userBusinesses  UserBusiness[]
  rolePermissions RolePermission[]
```

- [ ] **Step 4: Add `activeBusinessId` to `RefreshToken`**

In `model RefreshToken` (lines 119-135), add after `userId`/`user`:

```prisma
  activeBusinessId String
  activeBusiness   Business @relation(fields: [activeBusinessId], references: [id], onDelete: Cascade)
```

- [ ] **Step 5: Add `businessId` to the 11 scoped models**

For each model below, add `businessId String` + the `business` relation line right after the
model's `id` field, and add `@@index([businessId])` alongside its existing indexes.

`model Tender` (after `id`):
```prisma
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
```
add `@@index([businessId])` next to `@@index([clientId])`.

`model Project` (after `id`): same two lines; add `@@index([businessId])` next to `@@index([status])`.

`model Boq` (after `id`): same two lines; add `@@index([businessId])` next to `@@index([tenderId])`.

`model HistoricalRate` (after `id`): same two lines; add `@@index([businessId])` next to
`@@index([category, itemName])`.

`model Rfq` (after `id`): same two lines; add `@@index([businessId])` next to `@@index([tenderId])`.

`model PurchaseOrder` (after `id`): same two lines; add `@@index([businessId])` next to
`@@index([vendorId])`.

`model GoodsReceipt` (after `id`): same two lines; add `@@index([businessId])` next to
`@@index([purchaseOrderId])`.

`model BankAccount` (after `id`): same two lines; add `@@index([businessId])` (no existing
index block — add one).

`model Invoice` (after `id`): same two lines; add `@@index([businessId])` (no existing index
block — add one).

`model Expense` (after `id`): same two lines; add `@@index([businessId])` (no existing index
block — add one).

`model Payment` (after `id`): same two lines; add `@@index([businessId])` (no existing index
block — add one).

Use `onDelete: Restrict` on every one of these 11 `business` relations (mirrors this schema's
existing convention for data-owning FKs like `createdBy`) — a `Business` cannot be deleted while
it still has any operational data.

- [ ] **Step 6: Reset the dev database (existing data is disposable)**

Run: `dotenv -e .env -- pnpm --filter @bmp/database migrate:reset --force --skip-seed`
Expected: dev database dropped and recreated with existing migrations reapplied, seed skipped.
This must succeed before generating the new migration, since several of the new columns are
`NOT NULL` with no default and the dev DB may still have rows from prior seeding.

- [ ] **Step 7: Generate and apply the migration**

Run: `dotenv -e .env -- pnpm --filter @bmp/database migrate:dev -- --name multi_business_foundation`
Expected: a new migration directory under `packages/database/prisma/migrations/` is created and
applied cleanly (empty DB, so no data-loss prompts).

- [ ] **Step 8: Regenerate the Prisma client and typecheck the database package**

Run: `dotenv -e .env -- pnpm --filter @bmp/database generate && pnpm --filter @bmp/database typecheck`
Expected: `generate` succeeds; `typecheck` passes (schema-only package, no application code to
break yet).

- [ ] **Step 9: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(database): add Business/UserBusiness models and businessId scoping columns"
```

---

### Task 2: Shared request-context types

**Files:**
- Create: `apps/server/src/core/interfaces/request-context.ts`
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`, `apps/server/src/modules/projects/projects.service.ts`,
  `apps/server/src/modules/rfq/rfq.service.ts`, `apps/server/src/modules/purchase-orders/purchase-orders.service.ts`,
  `apps/server/src/modules/boq/boq.service.ts`, `apps/server/src/modules/organizations/organizations.service.ts`,
  `apps/server/src/modules/auth/auth.service.ts`

**Interfaces:**
- Produces: `RequestContext { ipAddress?: string; userAgent?: string }`,
  `ScopedRequestContext extends RequestContext { businessId: string }` — the type every scoped
  module's `create`/mutating service methods will use from Task 12 onward.

- [ ] **Step 1: Create the shared context file**

```typescript
// apps/server/src/core/interfaces/request-context.ts
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface ScopedRequestContext extends RequestContext {
  businessId: string;
}
```

- [ ] **Step 2: Replace the duplicated local declarations**

In each of `tenders.service.ts`, `projects.service.ts`, `rfq.service.ts`,
`purchase-orders.service.ts`, `organizations.service.ts`, `auth.service.ts`, remove the local:

```typescript
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}
```

and add an import instead:

```typescript
import type { RequestContext } from "../../core/interfaces/request-context.js";
```

Keep re-exporting nothing — callers of these services already import `RequestContext` from each
service module in some places; grep each file's importers (`grep -rn "RequestContext" apps/server/src/modules/<name>`)
before deleting, and update any external importer to pull from
`core/interfaces/request-context.js` instead.

- [ ] **Step 3: Fold `boq.service.ts`'s `AuditContext` into the shared type**

In `boq.service.ts`, remove the local:

```typescript
export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}
```

Replace every `AuditContext` reference with `RequestContext`, imported the same way as Step 2.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: PASS — this step is a pure rename/relocation, no behavior change yet.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/interfaces/request-context.ts apps/server/src/modules/tenders/tenders.service.ts apps/server/src/modules/projects/projects.service.ts apps/server/src/modules/rfq/rfq.service.ts apps/server/src/modules/purchase-orders/purchase-orders.service.ts apps/server/src/modules/boq/boq.service.ts apps/server/src/modules/organizations/organizations.service.ts apps/server/src/modules/auth/auth.service.ts
git commit -m "refactor(server): consolidate duplicated RequestContext/AuditContext into one shared type"
```

---

### Task 3: `businessId` on the JWT and `req.user`

**Files:**
- Modify: `apps/server/src/modules/auth/token.service.ts`, `apps/server/src/shared/middleware/authenticate.middleware.ts`
- Test: `apps/server/src/modules/auth/__tests__/token.service.spec.ts` (create if it doesn't exist)

**Interfaces:**
- Consumes: none new.
- Produces: `AccessTokenPayload { sub: string; roleId: string; roleName: string; businessId: string }`,
  `AuthenticatedUser { id: string; roleId: string; roleName: string; businessId: string }` (on `req.user`).

- [ ] **Step 1: Write the failing test**

Check whether `apps/server/src/modules/auth/__tests__/token.service.spec.ts` exists; if not,
create it:

```typescript
import { describe, expect, it } from "vitest";

import { TokenService } from "../token.service.js";

describe("TokenService", () => {
  it("round-trips businessId through sign/verify", () => {
    const service = new TokenService();
    const { token } = service.signAccessToken({
      sub: "user-1",
      roleId: "role-1",
      roleName: "ADMIN",
      businessId: "business-1",
    });
    const decoded = service.verifyAccessToken(token);
    expect(decoded.businessId).toBe("business-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/auth/__tests__/token.service.spec.ts`
Expected: FAIL — TypeScript error, `businessId` does not exist on the payload type passed to
`signAccessToken`.

- [ ] **Step 3: Add `businessId` to `AccessTokenPayload` and thread it through sign/verify**

In `apps/server/src/modules/auth/token.service.ts`, change:

```typescript
export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
}
```

to:

```typescript
export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  businessId: string;
}
```

and in `verifyAccessToken`, change the return object to also read `businessId`:

```typescript
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
      if (typeof decoded === "string") throw new UnauthorizedError("Invalid access token");
      return {
        sub: decoded.sub as string,
        roleId: (decoded as jwt.JwtPayload & AccessTokenPayload).roleId,
        roleName: (decoded as jwt.JwtPayload & AccessTokenPayload).roleName,
        businessId: (decoded as jwt.JwtPayload & AccessTokenPayload).businessId,
      };
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  }
```

`signAccessToken` itself needs no code change — it already signs whatever payload object it's
given; only the type signature (already updated above) constrains callers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/auth/__tests__/token.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Propagate `businessId` onto `req.user`**

In `apps/server/src/shared/middleware/authenticate.middleware.ts`, change:

```typescript
export interface AuthenticatedUser {
  id: string;
  roleId: string;
  roleName: string;
}
```

to:

```typescript
export interface AuthenticatedUser {
  id: string;
  roleId: string;
  roleName: string;
  businessId: string;
}
```

and change the assignment in `authenticateMiddleware`:

```typescript
  req.user = { id: payload.sub, roleId: payload.roleId, roleName: payload.roleName, businessId: payload.businessId };
```

- [ ] **Step 6: Typecheck the server package**

Run: `pnpm --filter @bmp/server typecheck`
Expected: FAIL at this point — `auth.service.ts`'s `signAccessToken({ sub, roleId, roleName })`
call sites (in `login()` and `refresh()`) no longer satisfy `AccessTokenPayload` because
`businessId` is missing. This is expected; Task 8 fixes those call sites. Confirm the *only*
typecheck errors are in `auth.service.ts`'s `signAccessToken` calls before moving on — if errors
appear elsewhere, something in this task's edit was wrong.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/auth/token.service.ts apps/server/src/shared/middleware/authenticate.middleware.ts apps/server/src/modules/auth/__tests__/token.service.spec.ts
git commit -m "feat(server): add businessId claim to access tokens and req.user"
```

---

### Task 4: RBAC — `businesses:*` permission keys

**Files:**
- Modify: `packages/types/src/rbac.ts`

**Interfaces:**
- Produces: permission keys `"businesses:create"`, `"businesses:read"`, `"businesses:update"`,
  `"businesses:delete"`, `"businesses:manage_members"`.

- [ ] **Step 1: Add the new permission keys**

In `packages/types/src/rbac.ts`, in the `PERMISSION_KEYS` array, add after the last existing
entry (`"reports:read"`):

```typescript
  "businesses:create",
  "businesses:read",
  "businesses:update",
  "businesses:delete",
  "businesses:manage_members",
```

- [ ] **Step 2: Exclude the new keys from `ALL_STANDARD_PERMISSIONS`**

`ADMIN` currently gets every key in `PERMISSION_KEYS` via `ALL_STANDARD_PERMISSIONS =
[...PERMISSION_KEYS]`. A business-scoped `ADMIN` must **not** automatically get the power to
create/delete other businesses or add members to businesses they don't belong to — that's an
owner-level (`SUPER_ADMIN`, wildcard) capability. Change:

```typescript
const ALL_STANDARD_PERMISSIONS: PermissionKey[] = [...PERMISSION_KEYS];
```

to:

```typescript
const ALL_STANDARD_PERMISSIONS: PermissionKey[] = PERMISSION_KEYS.filter(
  (key) => !key.startsWith("businesses:"),
);
```

`SUPER_ADMIN` is unaffected — it already receives the blanket wildcard permission (`"*:*"`)
in the seed script, independent of `ALL_STANDARD_PERMISSIONS`, and `isAuthorized()` in
`requirePermission.middleware.ts` treats that wildcard as matching everything.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/types typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/rbac.ts
git commit -m "feat(types): add businesses:* permission keys, scoped to SUPER_ADMIN only"
```

---

## Phase B — Users, Businesses module, and auth retrofit

### Task 5: Users module — per-business role

**Files:**
- Modify: `apps/server/src/modules/users/users.repository.ts`, `apps/server/src/modules/users/users.mapper.ts`,
  `apps/server/src/modules/users/users.service.ts`
- Test: `apps/server/src/modules/users/__tests__/users.service.spec.ts`

**Interfaces:**
- Consumes: `UserBusiness` (Task 1).
- Produces: `UserWithRole` (now includes `userBusinesses` filtered to one business),
  `CreateUserData` (adds `businessId`), `assignRole(id, businessId, roleId)`,
  `UserFilters.businessId` (required).

- [ ] **Step 1: Rewrite the repository's include shape and types**

In `apps/server/src/modules/users/users.repository.ts`, this file has no scoped `businessId`
column on `User` itself — scoping happens via the `userBusinesses` relation. Replace:

```typescript
const userWithRole = {
  include: { role: true, avatarAttachment: true },
} satisfies Prisma.UserDefaultArgs;

export type UserWithRole = Prisma.UserGetPayload<typeof userWithRole>;
```

with a factory that filters the included membership row to one business (since a user may have
many `UserBusiness` rows but a `UserWithRole` should reflect their role *in the business being
queried*):

```typescript
function userWithRoleArgs(businessId: string) {
  return {
    include: {
      avatarAttachment: true,
      userBusinesses: { where: { businessId }, include: { role: true } },
    },
  } satisfies Prisma.UserDefaultArgs;
}

export type UserWithRole = Prisma.UserGetPayload<ReturnType<typeof userWithRoleArgs>>;
```

- [ ] **Step 2: Update `CreateUserData`, `UserFilters`, and the interface signatures**

Replace:

```typescript
export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  roleId: string;
  passwordHash: string;
  createdById?: string | null;
  isEmailVerified?: boolean;
}
```

with:

```typescript
export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  businessId: string;
  roleId: string;
  passwordHash: string;
  createdById?: string | null;
  isEmailVerified?: boolean;
}
```

Replace:

```typescript
export interface UserFilters {
  search?: string;
  roleId?: string;
  isActive?: boolean;
}
```

with:

```typescript
export interface UserFilters {
  businessId: string;
  search?: string;
  roleId?: string;
  isActive?: boolean;
}
```

Update the `IUsersRepository` interface: `findById`/`findByEmail` gain a required `businessId`
parameter (needed to know which membership row to include), and `assignRole` gains a
`businessId` parameter:

```typescript
export interface IUsersRepository {
  findById(id: string, businessId: string): Promise<UserWithRole | null>;
  findByEmail(email: string, businessId: string): Promise<UserWithRole | null>;
  findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }>;
  create(data: CreateUserData): Promise<UserWithRole>;
  update(id: string, data: UpdateUserData): Promise<UserWithRole>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void>;
  assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole>;
  updateLastLoginAt(id: string): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  countTotal(businessId: string): Promise<number>;
}
```

- [ ] **Step 3: Rewrite the implementation methods**

```typescript
export class UsersRepository implements IUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithRoleArgs(businessId) });
  }

  findByEmail(email: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithRoleArgs(businessId) });
  }

  async findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }> {
    const where: Prisma.UserWhereInput = {
      userBusinesses: {
        some: {
          businessId: filters.businessId,
          ...(filters.roleId ? { roleId: filters.roleId } : {}),
        },
      },
      isActive: filters.isActive,
      ...(filters.search
        ? {
            OR: [
              { email: { contains: filters.search, mode: "insensitive" } },
              { firstName: { contains: filters.search, mode: "insensitive" } },
              { lastName: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...userWithRoleArgs(filters.businessId),
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalItems };
  }

  async create(data: CreateUserData): Promise<UserWithRole> {
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        passwordHash: data.passwordHash,
        createdById: data.createdById,
        isEmailVerified: data.isEmailVerified ?? false,
        userBusinesses: {
          create: { businessId: data.businessId, roleId: data.roleId },
        },
      },
    });
    return this.findById(user.id, data.businessId) as Promise<UserWithRole>;
  }

  update(id: string, data: UpdateUserData): Promise<UserWithRole> {
    // update() doesn't change role/business, so any existing membership's businessId works
    // for the returned include — callers only read name/contact fields off the result.
    return this.prisma.user
      .update({ where: { id }, data })
      .then(async (updated) => {
        const membership = await this.prisma.userBusiness.findFirst({ where: { userId: id } });
        return this.findById(updated.id, membership!.businessId) as Promise<UserWithRole>;
      });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { avatarAttachmentId } });
  }

  async assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole> {
    await this.prisma.userBusiness.upsert({
      where: { userId_businessId: { userId: id, businessId } },
      update: { roleId },
      create: { userId: id, businessId, roleId },
    });
    return this.findById(id, businessId) as Promise<UserWithRole>;
  }

  async updateLastLoginAt(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
  }

  countTotal(businessId: string): Promise<number> {
    return this.prisma.user.count({ where: { userBusinesses: { some: { businessId } } } });
  }
}
```

- [ ] **Step 4: Update the mapper to read the filtered membership**

In `apps/server/src/modules/users/users.mapper.ts`, change:

```typescript
    role: { id: user.role.id, name: user.role.name as UserDto["role"]["name"], description: user.role.description },
```

to read off the (now single, pre-filtered) `userBusinesses[0]`:

```typescript
    role: {
      id: user.userBusinesses[0]!.role.id,
      name: user.userBusinesses[0]!.role.name as UserDto["role"]["name"],
      description: user.userBusinesses[0]!.role.description,
    },
```

`user.userBusinesses[0]!` is safe because every `UserWithRole` returned by the repository was
fetched via `userWithRoleArgs(businessId)`, which already filters to exactly the membership row
for that business — a `UserWithRole` is only ever constructed for a user who has a membership in
the business being queried.

- [ ] **Step 5: Update `users.service.ts` call sites**

Every `usersRepository.findById(id)` / `.findByEmail(email)` / `.findMany(pagination, filters)` /
`.assignRole(id, roleId)` / `.countTotal()` call in `users.service.ts` needs a `businessId`
argument threaded in from the calling controller (via `req.user!.businessId`). Locate each call
site with `grep -n "usersRepository\.\(findById\|findByEmail\|findMany\|assignRole\|countTotal\)" apps/server/src/modules/users/users.service.ts`,
add a `businessId: string` parameter to the enclosing service method, and pass it straight
through to the repository call. Also update `users.controller.ts` call sites to pass
`req.user!.businessId` into each service method, and `users.validation.ts`'s list-query schema
is unaffected (businessId isn't client-supplied).

- [ ] **Step 6: Update the unit test fake repository**

In `apps/server/src/modules/users/__tests__/users.service.spec.ts`, update the fake
`IUsersRepository` implementation to match the new signatures (`findById(id, businessId)`,
`assignRole(id, businessId, roleId)`, etc.) — since the fake stores users in an in-memory `Map`
keyed by id, `businessId` can simply be accepted and ignored by the fake (single-business test
fixtures don't need real isolation logic), but the signature must match `IUsersRepository`
exactly or the test file won't compile.

- [ ] **Step 7: Run the unit tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/users`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: remaining errors should now only be in `auth.service.ts` (Task 8 fixes it) and any
not-yet-touched scoped modules (Tasks 12-18 fix those). If Users-module-related errors remain,
fix them before proceeding.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/users
git commit -m "feat(server): scope Users module to per-business role via UserBusiness"
```

---

### Task 6: Businesses module (new)

**Files:**
- Create: `apps/server/src/modules/businesses/businesses.repository.ts`
- Create: `apps/server/src/modules/businesses/businesses.service.ts`
- Create: `apps/server/src/modules/businesses/businesses.controller.ts`
- Create: `apps/server/src/modules/businesses/businesses.validation.ts`
- Create: `apps/server/src/modules/businesses/businesses.mapper.ts`
- Create: `apps/server/src/modules/businesses/businesses.routes.ts`
- Create: `apps/server/src/modules/businesses/businesses.module.ts`
- Test: `apps/server/src/modules/businesses/__tests__/businesses.service.spec.ts`

**Interfaces:**
- Consumes: `Business`, `BusinessContact`, `UserBusiness` (Task 1); `businesses:*` permission
  keys (Task 4).
- Produces: `businessesRouter` (exported for Task 7); `IBusinessesRepository` with `findById`,
  `findMany`, `create`, `update`, `delete`, `createContact`, `updateContact`, `deleteContact`,
  `addMember(businessId, userId, roleId)`, `updateMemberRole(businessId, userId, roleId)`,
  `removeMember(businessId, userId)`, `listMembers(businessId)`.

This module mirrors `apps/server/src/modules/organizations/` exactly (same 5-file shape,
`Organization`/`OrganizationContact` → `Business`/`BusinessContact`), plus membership endpoints
that `organizations` has no equivalent of.

- [ ] **Step 1: Write the repository**

```typescript
// apps/server/src/modules/businesses/businesses.repository.ts
import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const businessWithContacts = {
  include: { contacts: true, _count: { select: { tenders: true } } },
} satisfies Prisma.BusinessDefaultArgs;

export type BusinessWithContacts = Prisma.BusinessGetPayload<typeof businessWithContacts>;

export interface CreateBusinessData {
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstNumber?: string | null;
  udyamRegistrationNumber?: string | null;
  msmeCategory?: string | null;
  panNumber?: string | null;
  website?: string | null;
  notes?: string | null;
}

export interface UpdateBusinessData extends Partial<CreateBusinessData> {
  isActive?: boolean;
}

export interface BusinessFilters {
  search?: string;
  isActive?: boolean;
}

export interface CreateContactData {
  businessId: string;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export interface UpdateContactData {
  name?: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export interface MemberWithRole {
  userId: string;
  businessId: string;
  roleId: string;
  roleName: string;
  userEmail: string;
  userFirstName: string;
  userLastName: string;
}

export interface IBusinessesRepository {
  findById(id: string): Promise<BusinessWithContacts | null>;
  findMany(
    pagination: PaginationParams,
    filters: BusinessFilters,
  ): Promise<{ items: BusinessWithContacts[]; totalItems: number }>;
  create(data: CreateBusinessData): Promise<BusinessWithContacts>;
  update(id: string, data: UpdateBusinessData): Promise<BusinessWithContacts>;
  delete(id: string): Promise<void>;
  countTenders(id: string): Promise<number>;
  createContact(data: CreateContactData): Promise<void>;
  updateContact(id: string, data: UpdateContactData): Promise<void>;
  deleteContact(id: string): Promise<void>;
  findContactById(id: string): Promise<{ businessId: string } | null>;
  addMember(businessId: string, userId: string, roleId: string): Promise<void>;
  updateMemberRole(businessId: string, userId: string, roleId: string): Promise<void>;
  removeMember(businessId: string, userId: string): Promise<void>;
  listMembers(businessId: string): Promise<MemberWithRole[]>;
  findMembership(userId: string, businessId: string): Promise<{ roleId: string } | null>;
  listUserBusinesses(userId: string): Promise<Array<{ businessId: string; businessName: string; businessCode: string }>>;
}

export class BusinessesRepository implements IBusinessesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<BusinessWithContacts | null> {
    return this.prisma.business.findUnique({ where: { id }, ...businessWithContacts });
  }

  async findMany(
    pagination: PaginationParams,
    filters: BusinessFilters,
  ): Promise<{ items: BusinessWithContacts[]; totalItems: number }> {
    const where: Prisma.BusinessWhereInput = {
      isActive: filters.isActive,
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.prisma.business.findMany({
        where,
        ...businessWithContacts,
        orderBy: { name: "asc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.business.count({ where }),
    ]);
    return { items, totalItems };
  }

  create(data: CreateBusinessData): Promise<BusinessWithContacts> {
    return this.prisma.business.create({ data: { id: randomUUID(), ...data }, ...businessWithContacts });
  }

  update(id: string, data: UpdateBusinessData): Promise<BusinessWithContacts> {
    return this.prisma.business.update({ where: { id }, data, ...businessWithContacts });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.business.delete({ where: { id } });
  }

  countTenders(id: string): Promise<number> {
    return this.prisma.tender.count({ where: { businessId: id } });
  }

  async createContact(data: CreateContactData): Promise<void> {
    await this.prisma.businessContact.create({ data: { id: randomUUID(), ...data } });
  }

  async updateContact(id: string, data: UpdateContactData): Promise<void> {
    await this.prisma.businessContact.update({ where: { id }, data });
  }

  async deleteContact(id: string): Promise<void> {
    await this.prisma.businessContact.delete({ where: { id } });
  }

  findContactById(id: string): Promise<{ businessId: string } | null> {
    return this.prisma.businessContact.findUnique({ where: { id }, select: { businessId: true } });
  }

  async addMember(businessId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.userBusiness.create({ data: { userId, businessId, roleId } });
  }

  async updateMemberRole(businessId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.userBusiness.update({
      where: { userId_businessId: { userId, businessId } },
      data: { roleId },
    });
  }

  async removeMember(businessId: string, userId: string): Promise<void> {
    await this.prisma.userBusiness.delete({ where: { userId_businessId: { userId, businessId } } });
  }

  async listMembers(businessId: string): Promise<MemberWithRole[]> {
    const rows = await this.prisma.userBusiness.findMany({
      where: { businessId },
      include: { user: true, role: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      businessId: row.businessId,
      roleId: row.roleId,
      roleName: row.role.name,
      userEmail: row.user.email,
      userFirstName: row.user.firstName,
      userLastName: row.user.lastName,
    }));
  }

  findMembership(userId: string, businessId: string): Promise<{ roleId: string } | null> {
    return this.prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { roleId: true },
    });
  }

  async listUserBusinesses(
    userId: string,
  ): Promise<Array<{ businessId: string; businessName: string; businessCode: string }>> {
    const rows = await this.prisma.userBusiness.findMany({
      where: { userId },
      include: { business: true },
    });
    return rows.map((row) => ({
      businessId: row.businessId,
      businessName: row.business.name,
      businessCode: row.business.code,
    }));
  }
}
```

- [ ] **Step 2: Write the service**

```typescript
// apps/server/src/modules/businesses/businesses.service.ts
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import type { PaginationParams } from "../../core/interfaces/pagination.js";
import type { AuditService } from "../audit/audit.service.js";

import type {
  BusinessFilters,
  CreateBusinessData,
  CreateContactData,
  IBusinessesRepository,
  UpdateBusinessData,
  UpdateContactData,
} from "./businesses.repository.js";
import { toBusinessDto } from "./businesses.mapper.js";
import type { BusinessDto } from "./businesses.mapper.js";

export class BusinessesService {
  constructor(
    private readonly businessesRepository: IBusinessesRepository,
    private readonly auditService: AuditService,
  ) {}

  async listBusinesses(pagination: PaginationParams, filters: BusinessFilters) {
    const { items, totalItems } = await this.businessesRepository.findMany(pagination, filters);
    return { items: items.map(toBusinessDto), totalItems };
  }

  async getById(id: string): Promise<BusinessDto> {
    const business = await this.businessesRepository.findById(id);
    if (!business) throw new NotFoundError("Business not found");
    return toBusinessDto(business);
  }

  async create(data: CreateBusinessData, actorId: string, context: RequestContext = {}): Promise<BusinessDto> {
    const business = await this.businessesRepository.create(data);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_CREATED",
      entityType: "Business",
      entityId: business.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toBusinessDto(business);
  }

  async update(id: string, data: UpdateBusinessData, actorId: string, context: RequestContext = {}): Promise<BusinessDto> {
    await this.getById(id);
    const business = await this.businessesRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_UPDATED",
      entityType: "Business",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toBusinessDto(business);
  }

  async delete(id: string, actorId: string, context: RequestContext = {}): Promise<void> {
    await this.getById(id);
    const tenderCount = await this.businessesRepository.countTenders(id);
    if (tenderCount > 0) {
      throw new ConflictError("Cannot delete a business that still has tenders");
    }
    await this.businessesRepository.delete(id);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_DELETED",
      entityType: "Business",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async addContact(businessId: string, data: Omit<CreateContactData, "businessId">): Promise<BusinessDto> {
    await this.getById(businessId);
    await this.businessesRepository.createContact({ ...data, businessId });
    return this.getById(businessId);
  }

  async updateContact(businessId: string, contactId: string, data: UpdateContactData): Promise<BusinessDto> {
    await this.assertContactBelongsToBusiness(businessId, contactId);
    await this.businessesRepository.updateContact(contactId, data);
    return this.getById(businessId);
  }

  async deleteContact(businessId: string, contactId: string): Promise<BusinessDto> {
    await this.assertContactBelongsToBusiness(businessId, contactId);
    await this.businessesRepository.deleteContact(contactId);
    return this.getById(businessId);
  }

  private async assertContactBelongsToBusiness(businessId: string, contactId: string): Promise<void> {
    const contact = await this.businessesRepository.findContactById(contactId);
    if (!contact || contact.businessId !== businessId) {
      throw new NotFoundError("Business contact not found");
    }
  }

  async listMembers(businessId: string) {
    await this.getById(businessId);
    return this.businessesRepository.listMembers(businessId);
  }

  async addMember(businessId: string, userId: string, roleId: string, actorId: string): Promise<void> {
    await this.getById(businessId);
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (existing) throw new ConflictError("User is already a member of this business");
    await this.businessesRepository.addMember(businessId, userId, roleId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_ADDED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId, roleId },
    });
  }

  async updateMemberRole(businessId: string, userId: string, roleId: string, actorId: string): Promise<void> {
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (!existing) throw new NotFoundError("Membership not found");
    await this.businessesRepository.updateMemberRole(businessId, userId, roleId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_ROLE_UPDATED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId, roleId },
    });
  }

  async removeMember(businessId: string, userId: string, actorId: string): Promise<void> {
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (!existing) throw new NotFoundError("Membership not found");
    const members = await this.businessesRepository.listMembers(businessId);
    if (members.length === 1) {
      throw new BadRequestError("Cannot remove the last member of a business");
    }
    await this.businessesRepository.removeMember(businessId, userId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_REMOVED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId },
    });
  }
}
```

- [ ] **Step 3: Write the mapper**

```typescript
// apps/server/src/modules/businesses/businesses.mapper.ts
import type { BusinessWithContacts } from "./businesses.repository.js";

export interface BusinessDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: string | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: Array<{
    id: string;
    name: string;
    designation: string | null;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function toBusinessDto(business: BusinessWithContacts): BusinessDto {
  return {
    id: business.id,
    name: business.name,
    code: business.code,
    address: business.address,
    city: business.city,
    state: business.state,
    pincode: business.pincode,
    gstNumber: business.gstNumber,
    udyamRegistrationNumber: business.udyamRegistrationNumber,
    msmeCategory: business.msmeCategory,
    panNumber: business.panNumber,
    website: business.website,
    notes: business.notes,
    isActive: business.isActive,
    tenderCount: business._count.tenders,
    contacts: business.contacts.map((c) => ({
      id: c.id,
      name: c.name,
      designation: c.designation,
      email: c.email,
      phone: c.phone,
      isPrimary: c.isPrimary,
    })),
    createdAt: business.createdAt.toISOString(),
    updatedAt: business.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Write the validation schemas**

```typescript
// apps/server/src/modules/businesses/businesses.validation.ts
import { z } from "zod";

export const createBusinessSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    code: z.string().min(1).max(20),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
    gstNumber: z.string().optional(),
    udyamRegistrationNumber: z.string().optional(),
    msmeCategory: z.enum(["MICRO", "SMALL", "MEDIUM"]).optional(),
    panNumber: z.string().optional(),
    website: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const updateBusinessSchema = z.object({
  body: createBusinessSchema.shape.body.partial().extend({
    isActive: z.boolean().optional(),
  }),
});

export const createContactSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    designation: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    isPrimary: z.boolean().optional(),
  }),
});

export const updateContactSchema = z.object({
  body: createContactSchema.shape.body.partial(),
});

export const addMemberSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    roleId: z.string().uuid(),
  }),
});

export const updateMemberSchema = z.object({
  body: z.object({
    roleId: z.string().uuid(),
  }),
});

export const listBusinessesQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().optional(),
    search: z.string().optional(),
    isActive: z.coerce.boolean().optional(),
  }),
});
```

- [ ] **Step 5: Write the controller**

```typescript
// apps/server/src/modules/businesses/businesses.controller.ts
import { asyncHandler } from "../../shared/utils/asyncHandler.js";
import { sendSuccess } from "../../shared/utils/response.js";

import type { BusinessesService } from "./businesses.service.js";

export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  list = asyncHandler(async (req, res) => {
    const { page, pageSize, search, isActive } = req.query as Record<string, string | undefined>;
    const result = await this.businessesService.listBusinesses(
      { page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined },
      { search, isActive: isActive === undefined ? undefined : isActive === "true" },
    );
    sendSuccess(res, result);
  });

  getById = asyncHandler(async (req, res) => {
    const business = await this.businessesService.getById(req.params.id!);
    sendSuccess(res, business);
  });

  create = asyncHandler(async (req, res) => {
    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    const business = await this.businessesService.create(req.body, req.user!.id, context);
    sendSuccess(res, business, "Business created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    const business = await this.businessesService.update(req.params.id!, req.body, req.user!.id, context);
    sendSuccess(res, business, "Business updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    await this.businessesService.delete(req.params.id!, req.user!.id, context);
    sendSuccess(res, null, "Business deleted");
  });

  addContact = asyncHandler(async (req, res) => {
    const business = await this.businessesService.addContact(req.params.id!, req.body);
    sendSuccess(res, business, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const business = await this.businessesService.updateContact(req.params.id!, req.params.contactId!, req.body);
    sendSuccess(res, business, "Contact updated");
  });

  deleteContact = asyncHandler(async (req, res) => {
    const business = await this.businessesService.deleteContact(req.params.id!, req.params.contactId!);
    sendSuccess(res, business, "Contact deleted");
  });

  listMembers = asyncHandler(async (req, res) => {
    const members = await this.businessesService.listMembers(req.params.id!);
    sendSuccess(res, members);
  });

  addMember = asyncHandler(async (req, res) => {
    await this.businessesService.addMember(req.params.id!, req.body.userId, req.body.roleId, req.user!.id);
    sendSuccess(res, null, "Member added", 201);
  });

  updateMember = asyncHandler(async (req, res) => {
    await this.businessesService.updateMemberRole(req.params.id!, req.params.userId!, req.body.roleId, req.user!.id);
    sendSuccess(res, null, "Member role updated");
  });

  removeMember = asyncHandler(async (req, res) => {
    await this.businessesService.removeMember(req.params.id!, req.params.userId!, req.user!.id);
    sendSuccess(res, null, "Member removed");
  });
}
```

- [ ] **Step 6: Write the routes**

```typescript
// apps/server/src/modules/businesses/businesses.routes.ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { BusinessesController } from "./businesses.controller.js";
import {
  addMemberSchema,
  createBusinessSchema,
  createContactSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
  updateContactSchema,
  updateMemberSchema,
} from "./businesses.validation.js";

export function createBusinessesRouter(controller: BusinessesController): Router {
  const router = Router();

  router.use(authenticateMiddleware);

  router.get("/", requirePermission("businesses:read"), validate(listBusinessesQuerySchema), controller.list);
  router.post("/", requirePermission("businesses:create"), validate(createBusinessSchema), controller.create);
  router.get("/:id", requirePermission("businesses:read"), controller.getById);
  router.patch("/:id", requirePermission("businesses:update"), validate(updateBusinessSchema), controller.update);
  router.delete("/:id", requirePermission("businesses:delete"), controller.deleteById);

  router.post("/:id/contacts", requirePermission("businesses:update"), validate(createContactSchema), controller.addContact);
  router.patch("/:id/contacts/:contactId", requirePermission("businesses:update"), validate(updateContactSchema), controller.updateContact);
  router.delete("/:id/contacts/:contactId", requirePermission("businesses:update"), controller.deleteContact);

  router.get("/:id/members", requirePermission("businesses:manage_members"), controller.listMembers);
  router.post("/:id/members", requirePermission("businesses:manage_members"), validate(addMemberSchema), controller.addMember);
  router.patch("/:id/members/:userId", requirePermission("businesses:manage_members"), validate(updateMemberSchema), controller.updateMember);
  router.delete("/:id/members/:userId", requirePermission("businesses:manage_members"), controller.removeMember);

  return router;
}
```

- [ ] **Step 7: Write the module composition root**

```typescript
// apps/server/src/modules/businesses/businesses.module.ts
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { BusinessesController } from "./businesses.controller.js";
import { BusinessesRepository } from "./businesses.repository.js";
import { createBusinessesRouter } from "./businesses.routes.js";
import { BusinessesService } from "./businesses.service.js";

const businessesRepository = new BusinessesRepository(prisma);
export const businessesService = new BusinessesService(businessesRepository, auditService);
const businessesController = new BusinessesController(businessesService);

export const businessesRouter = createBusinessesRouter(businessesController);
export { businessesRepository };
```

- [ ] **Step 8: Write the unit test**

```typescript
// apps/server/src/modules/businesses/__tests__/businesses.service.spec.ts
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditService } from "../../audit/audit.service.js";
import type {
  BusinessFilters,
  BusinessWithContacts,
  CreateBusinessData,
  IBusinessesRepository,
  MemberWithRole,
  UpdateBusinessData,
} from "../businesses.repository.js";
import { BusinessesService } from "../businesses.service.js";

function buildBusiness(overrides: Partial<BusinessWithContacts> = {}): BusinessWithContacts {
  return {
    id: randomUUID(),
    name: "Archie Udyog",
    code: "ARCHIE",
    address: null,
    city: null,
    state: null,
    pincode: null,
    gstNumber: null,
    udyamRegistrationNumber: null,
    msmeCategory: null,
    panNumber: null,
    website: null,
    notes: null,
    isActive: true,
    contacts: [],
    _count: { tenders: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessWithContacts;
}

class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  businesses = new Map<string, BusinessWithContacts>();
  members = new Map<string, MemberWithRole[]>();

  async findById(id: string) {
    return this.businesses.get(id) ?? null;
  }

  async findMany(_pagination: unknown, _filters: BusinessFilters) {
    const items = Array.from(this.businesses.values());
    return { items, totalItems: items.length };
  }

  async create(data: CreateBusinessData) {
    const business = buildBusiness({ id: randomUUID(), ...data });
    this.businesses.set(business.id, business);
    return business;
  }

  async update(id: string, data: UpdateBusinessData) {
    const existing = this.businesses.get(id)!;
    const updated = { ...existing, ...data };
    this.businesses.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.businesses.delete(id);
  }

  async countTenders(_id: string) {
    return 0;
  }

  async findMembership(userId: string, businessId: string) {
    const list = this.members.get(businessId) ?? [];
    const found = list.find((m) => m.userId === userId);
    return found ? { roleId: found.roleId } : null;
  }

  async listMembers(businessId: string) {
    return this.members.get(businessId) ?? [];
  }

  async addMember(businessId: string, userId: string, roleId: string) {
    const list = this.members.get(businessId) ?? [];
    list.push({ userId, businessId, roleId, roleName: "ADMIN", userEmail: "x@x.com", userFirstName: "X", userLastName: "Y" });
    this.members.set(businessId, list);
  }

  async removeMember(businessId: string, userId: string) {
    const list = this.members.get(businessId) ?? [];
    this.members.set(businessId, list.filter((m) => m.userId !== userId));
  }
}

describe("BusinessesService", () => {
  let repository: FakeBusinessesRepository;
  let auditService: AuditService;
  let service: BusinessesService;

  beforeEach(() => {
    repository = new FakeBusinessesRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new BusinessesService(repository as unknown as IBusinessesRepository, auditService);
  });

  it("creates a business and logs BUSINESS_CREATED", async () => {
    const dto = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    expect(dto.name).toBe("Archie Udyog");
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "BUSINESS_CREATED" }));
  });

  it("prevents removing the last member of a business", async () => {
    const business = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    await service.addMember(business.id, "user-1", "role-1", "actor-1");
    await expect(service.removeMember(business.id, "user-1", "actor-1")).rejects.toThrow(
      "Cannot remove the last member of a business",
    );
  });

  it("rejects adding a member who is already in the business", async () => {
    const business = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    await service.addMember(business.id, "user-1", "role-1", "actor-1");
    await expect(service.addMember(business.id, "user-1", "role-1", "actor-1")).rejects.toThrow(
      "User is already a member of this business",
    );
  });
});
```

- [ ] **Step 9: Run the tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/businesses`
Expected: PASS (3 tests)

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no new errors from the `businesses` module (errors elsewhere from earlier tasks are
expected until Task 8+ land).

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/modules/businesses
git commit -m "feat(server): add businesses module (CRUD + membership management)"
```

---

### Task 7: Wire the businesses router into the app

**Files:**
- Modify: `apps/server/src/routes/v1.router.ts`

**Interfaces:**
- Consumes: `businessesRouter` (Task 6).

- [ ] **Step 1: Register the route**

In `apps/server/src/routes/v1.router.ts`, find the existing `router.use("/organizations",
organizationsRouter)`-style registration and add, in the same pattern:

```typescript
import { businessesRouter } from "../modules/businesses/businesses.module.js";
// ...
router.use("/businesses", businessesRouter);
```

- [ ] **Step 2: Typecheck and boot the server**

Run: `pnpm --filter @bmp/server typecheck`
Expected: passes for this file (whole-repo typecheck may still show pending errors from
not-yet-updated modules — that's expected at this point in the plan).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/routes/v1.router.ts
git commit -m "feat(server): mount /businesses routes"
```

---

### Task 8: `auth.service.ts` — resolve `UserBusiness`, embed `businessId`, add `switchBusiness`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.service.ts`, `apps/server/src/modules/auth/auth.repository.ts`
- Test: `apps/server/src/modules/auth/__tests__/auth.service.spec.ts` (create if it doesn't exist)

**Interfaces:**
- Consumes: `AccessTokenPayload.businessId` (Task 3), `businessesRepository.listUserBusinesses`/
  `findMembership` (Task 6).
- Produces: `AuthService.switchBusiness(userId, targetBusinessId, context)`.

This is the most subtle task in the plan: today, `refresh()` re-mints an access token purely
from `existing.userId` (the refresh token row) plus a fresh `User` lookup — it never re-decodes
the (expired) access token. Once role/business become per-`UserBusiness` rather than a scalar
`User.roleId`, `refresh()` needs to know *which* business was active without any access token to
read from. The fix: store `activeBusinessId` on the `RefreshToken` row itself (added in Task 1),
set at login/switch time, and carried forward on every rotation.

- [ ] **Step 1: Add `businessId` to `issueRefreshToken` and `RequestContext` usage**

In `apps/server/src/modules/auth/auth.repository.ts`, find `createRefreshToken(data: {...})` and
add `activeBusinessId: string` to its input type and the `prisma.refreshToken.create({ data:
{...} })` call — mirror however `userId`/`tokenHash`/`family` are already passed through.

- [ ] **Step 2: Add a `resolveActiveBusiness` helper to `auth.service.ts`**

```typescript
  private async resolveActiveBusiness(
    userId: string,
    preferredBusinessId?: string,
  ): Promise<{ businessId: string; roleId: string; roleName: string }> {
    const memberships = await this.businessesRepository.listUserBusinesses(userId);
    if (memberships.length === 0) {
      throw new UnauthorizedError("This account is not assigned to any business");
    }
    const chosen =
      memberships.find((m) => m.businessId === preferredBusinessId) ?? memberships[0]!;
    const membership = await this.businessesRepository.findMembership(userId, chosen.businessId);
    const role = await this.rolesRepository.findById(membership!.roleId);
    return { businessId: chosen.businessId, roleId: membership!.roleId, roleName: role!.name };
  }
```

This requires injecting `businessesRepository: IBusinessesRepository` and a way to read a
`Role` by id (`rolesRepository` — check whether one already exists via
`grep -rn "class.*RolesRepository\|IRolesRepository" apps/server/src/modules`; if none exists,
add a minimal `findById(id: string): Promise<{ id: string; name: string } | null>` method
directly via `prisma.role.findUnique` inline in `auth.service.ts` instead of a new repository —
don't build a whole new module for a single lookup). Add the new constructor parameter to
`AuthService`'s constructor and to its instantiation in `apps/server/src/modules/auth/auth.module.ts`.

- [ ] **Step 3: Update `login()`**

Replace:

```typescript
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: user.roleId,
      roleName: user.role.name,
    });
```

with:

```typescript
    const active = await this.resolveActiveBusiness(user.id);
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });
```

and change the `issueRefreshToken` call above it to pass `active.businessId` through (reorder so
`resolveActiveBusiness` runs before `issueRefreshToken`, since the refresh token row now needs
`activeBusinessId` too):

```typescript
    const active = await this.resolveActiveBusiness(user.id);
    const family = generateTokenFamily();
    const refreshToken = await this.issueRefreshToken(user.id, active.businessId, family, context);
```

(`issueRefreshToken`'s signature gains a `businessId: string` parameter, passed through to
`authRepository.createRefreshToken({ ..., activeBusinessId: businessId })`.)

- [ ] **Step 4: Update `refresh()`**

Replace:

```typescript
    const user = await this.usersRepository.findById(existing.userId);
    if (!user || !user.isActive) throw new UnauthorizedError("Account is not active");
    // ...
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: user.roleId,
      roleName: user.role.name,
    });
```

with:

```typescript
    const active = await this.resolveActiveBusiness(existing.userId, existing.activeBusinessId);
    const user = await this.usersRepository.findById(existing.userId, active.businessId);
    if (!user || !user.isActive) throw new UnauthorizedError("Account is not active");
    // ...
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });
```

and update the `createRefreshToken` call inside `refresh()` (the rotation step) to pass
`activeBusinessId: existing.activeBusinessId` (carried forward unchanged — refresh never
switches business).

- [ ] **Step 5: Add `switchBusiness`**

```typescript
  async switchBusiness(
    userId: string,
    targetBusinessId: string,
    context: RequestContext = {},
  ): Promise<RefreshResult> {
    const membership = await this.businessesRepository.findMembership(userId, targetBusinessId);
    if (!membership) {
      throw new ForbiddenError("You do not have access to this business");
    }
    const active = await this.resolveActiveBusiness(userId, targetBusinessId);
    const user = await this.usersRepository.findById(userId, active.businessId);
    if (!user || !user.isActive) throw new UnauthorizedError("Account is not active");

    const family = generateTokenFamily();
    const refreshToken = await this.issueRefreshToken(userId, active.businessId, family, context);
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: userId,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });

    await this.auditService.log({
      actorId: userId,
      action: "AUTH_BUSINESS_SWITCHED",
      entityType: "User",
      entityId: userId,
      metadata: { businessId: active.businessId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { accessToken, accessTokenExpiresAt: expiresAt.toISOString(), refreshToken };
  }
```

Import `ForbiddenError` from `../../core/errors/HttpErrors.js` alongside the existing
`ConflictError`/`NotFoundError`/`UnauthorizedError` import.

- [ ] **Step 6: Write the unit test**

```typescript
// apps/server/src/modules/auth/__tests__/auth.service.spec.ts (add if the file doesn't exist,
// otherwise add this describe block to the existing file)
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuthService } from "../auth.service.js";

describe("AuthService.switchBusiness", () => {
  it("throws ForbiddenError when the user has no membership in the target business", async () => {
    const businessesRepository = {
      findMembership: vi.fn().mockResolvedValue(null),
      listUserBusinesses: vi.fn(),
    };
    const service = new AuthService(
      {} as never, // usersRepository
      {} as never, // authRepository
      {} as never, // tokenService
      { log: vi.fn() } as never, // auditService
      {} as never, // attachmentsService
      {} as never, // emailService
      businessesRepository as never,
    );
    await expect(service.switchBusiness("user-1", "business-2")).rejects.toThrow(
      "You do not have access to this business",
    );
  });
});
```

Adjust the constructor argument order/count in this test to match whatever the final
`AuthService` constructor signature is after Step 2's new `businessesRepository` parameter is
added (check the actual parameter position via the file you just edited).

- [ ] **Step 7: Run the test**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/auth/__tests__/auth.service.spec.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: `auth.service.ts`/`auth.repository.ts`/`auth.module.ts` errors from Task 3 are now
resolved. Remaining errors should be confined to not-yet-updated scoped modules (Tasks 12-18).

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/auth
git commit -m "feat(server): resolve active business at login/refresh, add switchBusiness"
```

---

### Task 9: `POST /auth/switch-business`

**Files:**
- Modify: `apps/server/src/modules/auth/auth.controller.ts`, `apps/server/src/modules/auth/auth.routes.ts`
- Test: `apps/server/src/modules/auth/__tests__/auth.integration.spec.ts`

**Interfaces:**
- Consumes: `AuthService.switchBusiness` (Task 8).

- [ ] **Step 1: Add the controller method**

In `apps/server/src/modules/auth/auth.controller.ts`, add (following the `refresh`/`logoutAll`
pattern already in the file):

```typescript
  switchBusiness = asyncHandler(async (req, res) => {
    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    const result = await this.authService.switchBusiness(req.user!.id, req.body.businessId, context);
    setRefreshTokenCookie(res, result.refreshToken);
    sendSuccess(res, {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    }, "Business switched");
  });
```

- [ ] **Step 2: Add validation and the route**

In `apps/server/src/modules/auth/auth.routes.ts`, add a schema (in the same file or
`auth.validation.ts`, matching wherever `loginSchema` etc. already live):

```typescript
export const switchBusinessSchema = z.object({
  body: z.object({ businessId: z.string().uuid() }),
});
```

and register the route right after `/logout-all`:

```typescript
router.post(
  "/switch-business",
  authenticateMiddleware,
  validate(switchBusinessSchema),
  controller.switchBusiness,
);
```

- [ ] **Step 3: Write the integration test**

Add to `apps/server/src/modules/auth/__tests__/auth.integration.spec.ts` (following this file's
existing bootstrap pattern — seed `SUPER_ADMIN` role + wildcard permission, create two
`Business` rows, create a user with `UserBusiness` rows in both, log in, then):

```typescript
  it("switches active business and reflects it in the new access token", async () => {
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ businessId: secondBusinessId });

    expect(switchResponse.status).toBe(200);
    const newToken = switchResponse.body.data.accessToken as string;
    const decoded = JSON.parse(Buffer.from(newToken.split(".")[1]!, "base64").toString());
    expect(decoded.businessId).toBe(secondBusinessId);
  });

  it("rejects switching to a business the user doesn't belong to", async () => {
    const response = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ businessId: randomUUID() });

    expect(response.status).toBe(403);
  });
```

Add the `beforeAll` setup this test needs (a second `Business` row + a `UserBusiness` row
linking the test user to it) alongside the existing bootstrap in that file's `beforeAll`.

- [ ] **Step 4: Run the integration test**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/auth/__tests__/auth.integration.spec.ts`
Expected: PASS (requires `docker compose up -d postgres redis` running and migrations applied to
`bmp_test` — see Task 11 for why this test file needs updating regardless, ahead of the shared
helper).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/auth
git commit -m "feat(server): add POST /auth/switch-business endpoint"
```

---

### Task 10: Seed script — businesses and per-business user membership

**Files:**
- Modify: `packages/database/prisma/seed.ts`

**Interfaces:**
- Consumes: `Business`, `UserBusiness` (Task 1).

- [ ] **Step 1: Add `seedBusinesses()`**

```typescript
const SAMPLE_BUSINESSES = [
  { name: "Archie Udyog", code: "ARCHIE" },
  { name: "Samson Industries", code: "SAMSON" },
];

async function seedBusinesses(): Promise<Map<string, string>> {
  const businessByCode = new Map<string, string>();
  for (const sample of SAMPLE_BUSINESSES) {
    const business = await prisma.business.upsert({
      where: { code: sample.code },
      update: {},
      create: { id: randomUUID(), name: sample.name, code: sample.code },
    });
    businessByCode.set(sample.code, business.id);
  }
  return businessByCode;
}
```

- [ ] **Step 2: Update `seedUsers()` to create `UserBusiness` rows**

Replace:

```typescript
async function seedUsers(roleByName: Map<string, string>) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  for (const sample of SAMPLE_USERS) {
    const roleId = roleByName.get(sample.role);
    if (!roleId) continue;

    await prisma.user.upsert({
      where: { email: sample.email },
      update: {},
      create: {
        id: randomUUID(),
        email: sample.email,
        passwordHash,
        firstName: sample.firstName,
        lastName: sample.lastName,
        roleId,
        isActive: true,
        isEmailVerified: true,
      },
    });
  }
}
```

with:

```typescript
async function seedUsers(roleByName: Map<string, string>, businessByCode: Map<string, string>) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  const archieId = businessByCode.get("ARCHIE")!;
  const samsonId = businessByCode.get("SAMSON")!;

  for (const sample of SAMPLE_USERS) {
    const roleId = roleByName.get(sample.role);
    if (!roleId) continue;

    const user = await prisma.user.upsert({
      where: { email: sample.email },
      update: {},
      create: {
        id: randomUUID(),
        email: sample.email,
        passwordHash,
        firstName: sample.firstName,
        lastName: sample.lastName,
        isActive: true,
        isEmailVerified: true,
      },
    });

    // SUPER_ADMIN is the owner-level account — gets membership (and thus a business
    // switcher) in both seed businesses. Everyone else gets exactly one.
    const businessIds = sample.role === "SUPER_ADMIN" ? [archieId, samsonId] : [archieId];
    for (const businessId of businessIds) {
      await prisma.userBusiness.upsert({
        where: { userId_businessId: { userId: user.id, businessId } },
        update: { roleId },
        create: { userId: user.id, businessId, roleId },
      });
    }
  }
}
```

- [ ] **Step 3: Update `main()` to call `seedBusinesses()` first and pass its result through**

Locate `main()` (line 145-156) and change the orchestration from:

```typescript
async function main() {
  const roleByName = await seedRolesAndPermissions();
  await seedUsers(roleByName);
  await seedLocalDocsSyncUser(roleByName);
}
```

to:

```typescript
async function main() {
  const roleByName = await seedRolesAndPermissions();
  const businessByCode = await seedBusinesses();
  await seedUsers(roleByName, businessByCode);
  await seedLocalDocsSyncUser(roleByName, businessByCode);
}
```

(`seedLocalDocsSyncUser` also creates a `User` with a direct `roleId` today — check its body
with `grep -n "roleId" packages/database/prisma/seed.ts` and apply the same
User-create-then-UserBusiness-create split as Step 2, assigning it to the `ARCHIE` business
since it's a non-login system/attribution account whose business doesn't functionally matter.)

- [ ] **Step 4: Run the seed against a reset database**

Run: `dotenv -e .env -- pnpm --filter @bmp/database migrate:reset --force`
Expected: reset + migrations reapply + seed runs automatically (no `--skip-seed` this time) and
completes without error, creating 2 businesses, 9 users, and their `UserBusiness` rows.

- [ ] **Step 5: Manually verify via Prisma Studio**

Run: `dotenv -e .env -- pnpm --filter @bmp/database studio`
Expected: `businesses` table has 2 rows (ARCHIE, SAMSON); `user_businesses` table has 9 rows for
regular users (1 each) plus 2 extra rows for `superadmin@bmp.local` (one per business) = 10
total rows, wait — 8 sample users + 1 local-docs-sync user, with `superadmin@bmp.local` counted
once in `SAMPLE_USERS` getting 2 rows: total is 7 single-business users × 1 + 1 SUPER_ADMIN × 2 +
1 local-docs-sync user × 1 = 10 rows. Confirm this count matches. Close Studio when done.

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/seed.ts
git commit -m "feat(database): seed Archie Udyog and Samson Industries businesses with per-business user membership"
```

---

### Task 11: Shared integration-test auth helper

**Files:**
- Create: `apps/server/src/shared/test-utils/integration-auth.ts`
- Modify: `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts` (as the first
  consumer, proving the helper works — other integration spec files adopt it in Tasks 12-19 as
  each module is touched)

**Interfaces:**
- Produces: `createIntegrationTestUser(app, overrides?): Promise<{ userId, businessId, secondBusinessId, accessToken, email }>`.

Every existing `*.integration.spec.ts` file duplicates ~30 lines of role/permission/user/login
bootstrap (confirmed identically present in tenders, boq, finance, projects, procurement,
reports, auth). Since every scoped module's integration tests now also need a `Business` +
`UserBusiness` row (and ideally a *second* business, to assert cross-business isolation), this
is the right point to extract a shared helper rather than re-duplicating the now-larger bootstrap
seven more times.

- [ ] **Step 1: Write the helper**

```typescript
// apps/server/src/shared/test-utils/integration-auth.ts
import { randomUUID } from "node:crypto";

import { WILDCARD_PERMISSION } from "@bmp/types";
import type { Express } from "express";
import request from "supertest";

import { prisma } from "../../infra/prisma/client.js";
import { hashPassword } from "../utils/hash.js";

export interface IntegrationTestUser {
  userId: string;
  email: string;
  businessId: string;
  secondBusinessId: string;
  accessToken: string;
}

export async function createIntegrationTestUser(app: Express): Promise<IntegrationTestUser> {
  const email = `integration-${randomUUID()}@example.com`;
  const password = "Password123";

  const permission = await prisma.permission.upsert({
    where: { key: WILDCARD_PERMISSION },
    update: {},
    create: { id: randomUUID(), key: WILDCARD_PERMISSION, resource: "*", action: "*" },
  });
  const role = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: {},
    create: { id: randomUUID(), name: "SUPER_ADMIN", description: "Super Admin", isSystem: true },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { id: randomUUID(), roleId: role.id, permissionId: permission.id },
  });

  const business = await prisma.business.create({
    data: { id: randomUUID(), name: `Integration Business ${randomUUID()}`, code: `IB${randomUUID().slice(0, 8)}` },
  });
  const secondBusiness = await prisma.business.create({
    data: { id: randomUUID(), name: `Integration Business B ${randomUUID()}`, code: `IB2${randomUUID().slice(0, 8)}` },
  });

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
      firstName: "Integration",
      lastName: "Tester",
      isActive: true,
      isEmailVerified: true,
    },
  });

  await prisma.userBusiness.create({ data: { userId: user.id, businessId: business.id, roleId: role.id } });
  await prisma.userBusiness.create({ data: { userId: user.id, businessId: secondBusiness.id, roleId: role.id } });

  const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });

  return {
    userId: user.id,
    email,
    businessId: business.id,
    secondBusinessId: secondBusiness.id,
    accessToken: loginResponse.body.data.accessToken as string,
  };
}

export async function cleanupIntegrationTestUser(testUser: IntegrationTestUser): Promise<void> {
  await prisma.userBusiness.deleteMany({ where: { userId: testUser.userId } });
  await prisma.business.deleteMany({ where: { id: { in: [testUser.businessId, testUser.secondBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: testUser.userId } });
}
```

Check the exact export name/path for the password-hashing util (`comparePassword`/`hashPassword`
were seen imported from `../../shared/utils/hash.js` in `auth.service.ts` — reuse that same
import path here).

- [ ] **Step 2: Adopt it in `tenders.integration.spec.ts`**

Replace the file's existing `beforeAll` bootstrap block (role/permission/user/login, currently
~30 lines) with:

```typescript
import { cleanupIntegrationTestUser, createIntegrationTestUser } from "../../../shared/test-utils/integration-auth.js";

// inside beforeAll:
const testUser = await createIntegrationTestUser(app);
accessToken = testUser.accessToken;
userId = testUser.userId;
businessId = testUser.businessId;
```

and its `afterAll` cleanup to call `cleanupIntegrationTestUser(testUser)` (in addition to the
tender-specific cleanup — e.g. `prisma.tender.deleteMany({ where: { createdById: userId } })` —
which should run *before* `cleanupIntegrationTestUser` since it deletes the `User`/`Business`
rows those tenders reference).

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.integration.spec.ts`
Expected: PASS (requires `docker compose up -d postgres redis minio minio-init` and
`bmp_test` migrated — per this repo's existing integration test setup).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/shared/test-utils/integration-auth.ts apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts
git commit -m "test(server): extract shared integration-test auth/business bootstrap helper"
```

---

## Phase C — Scope each operational module

Each task in this phase follows the same shape: extend the module's `CreateXData`/`XFilters`
with `businessId`, thread it from `req.user!.businessId` through the service into the
repository's `where`/`data`, update the unit test's fake repository to match the new interface,
and add an integration-test isolation assertion (using the Task 11 helper's `businessId` /
`secondBusinessId`).

### Task 12: Scope the tenders module

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`, `apps/server/src/modules/tenders/tenders.service.ts`,
  `apps/server/src/modules/tenders/tenders.controller.ts`
- Test: `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts`,
  `apps/server/src/modules/tenders/__tests__/tenders.integration.spec.ts`

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2), `req.user!.businessId` (Task 3).
- Produces: `CreateTenderData.businessId`, `TenderFilters.businessId`.

- [ ] **Step 1: Write the failing integration test**

Add to `tenders.integration.spec.ts` (using `testUser.secondBusinessId` from Task 11's helper):

```typescript
  it("does not return another business's tenders", async () => {
    const otherLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: "Password123",
    });
    // switch to the second business this same test user also belongs to
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
      .send({ businessId: testUser.secondBusinessId });
    const secondBusinessToken = switchResponse.body.data.accessToken as string;

    const createResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`) // first business
      .send({ /* same payload as the existing "creates a tender" test */ });
    const tenderId = createResponse.body.data.id as string;

    const listResponse = await request(app)
      .get("/api/v1/tenders")
      .set("Authorization", `Bearer ${secondBusinessToken}`);

    expect(listResponse.body.data.items.map((t: { id: string }) => t.id)).not.toContain(tenderId);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/tenders/__tests__/tenders.integration.spec.ts`
Expected: FAIL — the new tender shows up in both businesses' lists, since scoping doesn't exist
yet.

- [ ] **Step 3: Add `businessId` to `CreateTenderData` and `TenderFilters`**

```typescript
export interface CreateTenderData {
  tenderNumber: string;
  title: string;
  department: string;
  clientId: string;
  type: string;
  category: string;
  location: string;
  state: string;
  estimatedCost: number;
  emdAmount?: number | null;
  tenderFee?: number | null;
  documentFee?: number | null;
  submissionDate: Date;
  openingDate?: Date | null;
  validityPeriodDays?: number | null;
  priority?: TenderPriority;
  description?: string | null;
  remarks?: string | null;
  dealingOfficerName?: string | null;
  dealingOfficerEmail?: string | null;
  dealingOfficerPhone?: string | null;
  businessId: string;
  createdById: string;
}
```

Add `businessId: string;` to `TenderFilters` (required, unlike its other optional fields).

- [ ] **Step 4: Update `findMany` and add `businessId` to `findById`/`findByTenderNumber`**

In the `where` construction inside `findMany`, add `businessId: filters.businessId` as an
unconditional field (not the optional-spread pattern used for `status`/`clientId` etc.).

Also scope the single-row lookups — `findById(id: string)` and `findByTenderNumber(tenderNumber:
string)` currently take no `businessId`, which means a valid tender ID from another business
could still be fetched directly (bypassing list scoping) via `GET /tenders/:id`, or via any
service method that resolves a tender by ID for a permission/existence check (e.g. RFQ/PO
creation validating `tenderId`). Change both to `findById(id: string, businessId: string)` /
`findByTenderNumber(tenderNumber: string, businessId: string)`, and add `businessId` to their
`where` clauses. Update `ITendersRepository` and every call site in `tenders.service.ts`
accordingly (each already has `businessId` available via the new `ScopedRequestContext`
parameter added in Step 5 below).

- [ ] **Step 5: Thread `businessId` through the service**

Change `create`'s signature from `RequestContext` to `ScopedRequestContext`:

```typescript
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";

async create(
  data: Omit<CreateTenderData, "businessId">,
  context: ScopedRequestContext,
): Promise<TenderDto> {
  const duplicate = await this.tendersRepository.findByTenderNumber(data.tenderNumber, context.businessId);
  if (duplicate) throw new ConflictError("A tender with this tender number already exists");
  const client = await this.organizationsRepository.findById(data.clientId);
  if (!client) throw new BadRequestError("Invalid client");
  const tender = await this.tendersRepository.create({ ...data, businessId: context.businessId });
  // ...unchanged local docs folder side-effect...
  await this.auditService.log({ actorId: data.createdById, action: "TENDER_CREATED", entityType: "Tender", entityId: tender.id, ipAddress: context.ipAddress, userAgent: context.userAgent });
  return toTenderDto(tender);
}
```

`context` was previously optional (`context: RequestContext = {}`) — it becomes a required
parameter now that `businessId` is non-optional; update every call site (controller, and any
other service method calling `create` internally) accordingly. Apply the same `businessId`
threading to `listTenders` (add `businessId` to the `filters` object it forwards) and to every
other method that calls `findById`/`update`/`delete`/`changeStatus`/`reopen` — each needs a
`businessId` (from `ScopedRequestContext` or a plain parameter) passed to the now-scoped
repository lookups.

- [ ] **Step 6: Update the controller**

In `tenders.controller.ts`, every `context = { ipAddress: req.ip, userAgent: ... }` object
literal passed into a scoped service call becomes `context = { ipAddress: req.ip, userAgent:
req.headers["user-agent"], businessId: req.user!.businessId }`. Any controller method calling
`findById`/similar directly (not through `create`) passes `req.user!.businessId` as a plain
argument.

- [ ] **Step 7: Update the unit test's fake repository**

In `tenders.service.spec.ts`, add `businessId` handling to `FakeTendersRepository`: `create`
stores whatever `businessId` it's given (already flows through via `...data`), and `findById`/
`findByTenderNumber` gain a `businessId` parameter that the fake can accept and ignore (single-
business test fixtures, same rationale as Task 5 Step 6) — but the signature must match
`ITendersRepository` exactly.

- [ ] **Step 8: Run all tenders tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/tenders`
Expected: PASS, including the new isolation test from Step 1.

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `tenders` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/tenders
git commit -m "feat(server): scope tenders module to businessId"
```

---

### Task 13: Scope the projects module

**Files:**
- Modify: `apps/server/src/modules/projects/projects.repository.ts`, `apps/server/src/modules/projects/projects.service.ts`,
  `apps/server/src/modules/projects/projects.controller.ts`
- Test: `apps/server/src/modules/projects/__tests__/projects.service.spec.ts`,
  `apps/server/src/modules/projects/__tests__/projects.integration.spec.ts`

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2), tenders module's now-scoped `findById(id,
  businessId)` (Task 12).

- [ ] **Step 1: Write the failing integration isolation test**

Same shape as Task 12 Step 1, adapted to `POST /api/v1/projects/from-tender` and `GET
/api/v1/projects` — create a `WON` tender + project in the first business, assert it's absent
from a `GET /projects` call made after switching to `secondBusinessId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/projects/__tests__/projects.integration.spec.ts`
Expected: FAIL

- [ ] **Step 3: Add `businessId` to `CreateProjectData` and `ProjectFilters`**

```typescript
export interface CreateProjectData {
  tenderId: string;
  businessId: string;
  name: string;
  budget: number;
  startDate: Date;
  endDate?: Date | null;
  location?: string | null;
  notes?: string | null;
  createdById: string;
}
```

`ProjectFilters` (currently just `{ status?: ProjectStatus }`) becomes `{ businessId: string;
status?: ProjectStatus }`.

- [ ] **Step 4: Update the repository**

`createFromTender`'s `prisma.project.create({ data: { id, ...data } })` call needs no structural
change (spreads `businessId` through automatically once it's in `CreateProjectData`). Update
`findMany`'s `where` to `{ businessId: filters.businessId, status: filters.status }`. Scope
`findByTenderId` and any `findById` the same way as Task 12 Step 4 — add a required `businessId`
parameter and include it in the `where`.

- [ ] **Step 5: Update the service — derive `businessId` from the source tender**

A Project is always created *from* a `Tender`, and that tender lookup already happens first in
`createFromTender`. Since Task 12 scoped `tendersRepository.findById` to require `businessId`,
the service must supply it — from the caller's active business, exactly like every other scoped
create:

```typescript
async createFromTender(
  input: CreateProjectFromTenderInput,
  actorId: string,
  context: ScopedRequestContext,
): Promise<ProjectDto> {
  const tender = await this.tendersRepository.findById(input.tenderId, context.businessId);
  if (!tender) throw new BadRequestError("Invalid tenderId");
  if (tender.status !== "WON") throw new ConflictError(/* unchanged message */);
  const existing = await this.projectsRepository.findByTenderId(input.tenderId, context.businessId);
  if (existing) throw new ConflictError("This tender already has a project");
  const budget = input.budget ?? tender.winningBidAmount ?? tender.estimatedCost;
  const projectId = await this.projectsRepository.createFromTender({
    tenderId: input.tenderId,
    businessId: context.businessId,
    name: input.name ?? tender.title,
    budget,
    startDate: new Date(input.startDate),
    endDate: input.endDate ? new Date(input.endDate) : null,
    location: input.location ?? tender.location,
    notes: input.notes,
    createdById: actorId,
  });
  await this.auditService.log({ actorId, action: "PROJECT_CREATED_FROM_TENDER", entityType: "Project", entityId: projectId, ipAddress: context.ipAddress, userAgent: context.userAgent });
  return this.getById(projectId, context.businessId);
}
```

Update `listProjects` to accept and forward `businessId` into `ProjectFilters`, and `getById` /
any other lookup method to take a `businessId` parameter passed to the now-scoped repository
calls.

- [ ] **Step 6: Update the controller**

Same pattern as Task 12 Step 6 — build `context: ScopedRequestContext` including
`businessId: req.user!.businessId`, pass `req.user!.businessId` to any direct lookup calls.

- [ ] **Step 7: Update the unit test's fake repository**

Same pattern as Task 12 Step 7 — accept and ignore `businessId` params in the fake, matching
`IProjectsRepository`'s new signatures exactly.

- [ ] **Step 8: Run all projects tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/projects`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `projects` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/projects
git commit -m "feat(server): scope projects module to businessId"
```

---

### Task 14: Scope the boq module

**Files:**
- Modify: `apps/server/src/modules/boq/boq.repository.ts`, `apps/server/src/modules/boq/boq.service.ts`,
  `apps/server/src/modules/boq/boq.controller.ts`
- Test: `apps/server/src/modules/boq/__tests__/boq.service.spec.ts`,
  `apps/server/src/modules/boq/__tests__/boq.integration.spec.ts`

**Interfaces:**
- Consumes: `RequestContext` (now unified in Task 2 — `boq.service.ts`'s `AuditContext` alias is
  already gone), scoped `tendersRepository.findById` (Task 12).

- [ ] **Step 1: Write the failing integration isolation test**

Same shape as Task 12/13 — commit a BOQ under a tender in the first business, assert
`GET /api/v1/tenders/:tenderId/boq` (or wherever BOQ is fetched) 404s or returns nothing when
called with a token switched to `secondBusinessId`. Since BOQ is always fetched via `tenderId`
and `tenders.findById` is now business-scoped (Task 12), this should mostly fall out of that
scoping — the isolation test here specifically confirms `assertTenderExists`/BOQ fetch paths
correctly propagate `businessId` rather than silently bypassing it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/boq/__tests__/boq.integration.spec.ts`
Expected: FAIL

- [ ] **Step 3: Add `businessId` to `CreateBoqData`**

```typescript
export interface CreateBoqData {
  id: string;
  tenderId: string;
  businessId: string;
  createdById: string;
  sourceAttachmentId: string | null;
  groupId: string;
  version: number;
  items: CreateBoqItemRow[];
}
```

- [ ] **Step 4: Update `createBoq`'s transaction**

```typescript
async createBoq(data: CreateBoqData): Promise<void> {
  await this.prisma.$transaction([
    this.prisma.boq.updateMany({ where: { tenderId: data.tenderId, businessId: data.businessId }, data: { isCurrent: false } }),
    this.prisma.boq.create({
      data: {
        id: data.id,
        tenderId: data.tenderId,
        businessId: data.businessId,
        sourceAttachmentId: data.sourceAttachmentId,
        groupId: data.groupId,
        version: data.version,
        isCurrent: true,
        status: "DRAFT" as BoqStatus,
        createdById: data.createdById,
      },
    }),
    this.prisma.boqItem.createMany({ data: data.items.map((item) => ({ ...item, boqId: data.id })) }),
  ]);
}
```

Scope `findVersions(groupId, businessId)` / `findCurrentBoq(tenderId, businessId)` (and any other
BOQ read method) the same way — add the parameter, add it to the Prisma `where`.

- [ ] **Step 5: Update `assertTenderExists` and `commitBoq` to thread `businessId`**

`assertTenderExists` currently just checks a tender exists by id — update it to call the now-
scoped `tendersRepository.findById(tenderId, businessId)`, requiring a `businessId` parameter.
Update `commitBoq`'s signature (context is now the already-unified `RequestContext`, but BOQ's
scoping needs its own `businessId` — since `commitBoq` doesn't otherwise take a
`ScopedRequestContext`, add `businessId: string` as an explicit parameter rather than folding
context and scoping together, since this module's existing `context` param is used purely for
`metadata` spreading, not scoping):

```typescript
async commitBoq(
  tenderId: string,
  businessId: string,
  input: CommitBoqBody,
  actorId: string,
  context: RequestContext,
): Promise<BoqDto> {
  await this.assertTenderExists(tenderId, businessId);
  // ...unchanged row-building logic...
  await this.boqRepository.createBoq({
    id: boqId,
    tenderId,
    businessId,
    createdById: actorId,
    sourceAttachmentId: input.sourceAttachmentId ?? null,
    groupId,
    version,
    items: rows,
  });
  await this.auditService.log({ actorId, action: "BOQ_COMMITTED", entityType: "Boq", entityId: boqId, metadata: { boqId, version, itemCount: rows.length, ...context } });
  return this.buildBoqDto(boqId, businessId);
}
```

- [ ] **Step 6: Update the controller**

Pass `req.user!.businessId` as the new explicit `businessId` argument into `commitBoq` and every
other now-scoped service method call.

- [ ] **Step 7: Update the unit test's fake repository**

Same pattern as prior tasks — accept and ignore `businessId` in the fake `IBoqRepository`.

- [ ] **Step 8: Run all boq tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/boq`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `boq` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/boq
git commit -m "feat(server): scope boq module to businessId"
```

---

### Task 15: Scope the rfq module

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.repository.ts`, `apps/server/src/modules/rfq/rfq.service.ts`,
  `apps/server/src/modules/rfq/rfq.controller.ts`
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`,
  `apps/server/src/modules/rfq/__tests__/*.integration.spec.ts` (wherever RFQ integration
  coverage lives — check `apps/server/src/modules/procurement/__tests__/procurement.integration.spec.ts`
  per the earlier research note that a `procurement.integration.spec.ts` file exists covering
  this area, and confirm with `find apps/server/src/modules -iname "*rfq*integration*" -o -iname "*procurement*integration*"`)

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2), scoped `tendersRepository.findById` (Task 12).

- [ ] **Step 1: Write the failing integration isolation test**

Same shape as prior tasks — create an RFQ (with no `tenderId`, since RFQs can exist standalone)
in the first business, assert it's absent from `GET /api/v1/rfqs` after switching to
`secondBusinessId`.

- [ ] **Step 2: Run test to verify it fails**

Run the located RFQ/procurement integration spec file with `vitest run <path>`.
Expected: FAIL

- [ ] **Step 3: Add `businessId` to `CreateRfqData` and `RfqFilters`**

```typescript
export interface CreateRfqData {
  title: string;
  tenderId?: string | null;
  businessId: string;
  dueDate?: Date | null;
  createdById: string;
  items: CreateRfqItemData[];
}
```

`RfqFilters` (currently `{ status?: RfqStatus; tenderId?: string }`) becomes `{ businessId:
string; status?: RfqStatus; tenderId?: string }`.

- [ ] **Step 4: Update the repository**

`create`'s transaction: add `businessId: data.businessId` to the `prisma.rfq.create({ data: {...}
} })` object. `findMany`'s `where` gains `businessId: filters.businessId` (unconditional). Scope
any `findById` the same way as prior tasks.

- [ ] **Step 5: Update the service**

```typescript
async create(
  input: Omit<CreateRfqData, "createdById" | "businessId"> & { vendorIds?: string[] },
  actorId: string,
  context: ScopedRequestContext,
): Promise<RfqDto> {
  if (input.items.length === 0) throw new BadRequestError("At least one RFQ item is required");
  if (input.tenderId) {
    const tender = await this.tendersRepository.findById(input.tenderId, context.businessId);
    if (!tender) throw new BadRequestError("Invalid tenderId");
  }
  const { vendorIds, ...createData } = input;
  const rfqId = await this.rfqRepository.create({ ...createData, businessId: context.businessId, createdById: actorId });
  // ...unchanged vendor invite logic...
  await this.auditService.log({ actorId, action: "RFQ_CREATED", entityType: "Rfq", entityId: rfqId, ipAddress: context.ipAddress, userAgent: context.userAgent });
  return this.getById(rfqId, context.businessId);
}
```

Update `listRfqs`/`getById`/`quickSend` (which internally calls `this.create(...)`) to thread
`businessId` through the same way. `quickSend` forwards its own `context` param already — since
that's now `ScopedRequestContext`, no extra plumbing needed there beyond the type change.

- [ ] **Step 6: Update the controller**

Same pattern as prior tasks — build `ScopedRequestContext` with `businessId: req.user!.businessId`.

- [ ] **Step 7: Update the unit test's fake repository**

Same pattern as prior tasks.

- [ ] **Step 8: Run all rfq tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/rfq`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `rfq` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/rfq
git commit -m "feat(server): scope rfq module to businessId"
```

---

### Task 16: Scope the purchase-orders module (Purchase Orders + Goods Receipts)

**Files:**
- Modify: `apps/server/src/modules/purchase-orders/purchase-orders.repository.ts`,
  `apps/server/src/modules/purchase-orders/purchase-orders.service.ts`,
  `apps/server/src/modules/purchase-orders/purchase-orders.controller.ts`
- Test: `apps/server/src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts`,
  relevant `*.integration.spec.ts`

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2), scoped `tendersRepository.findById` (Task 12).

- [ ] **Step 1: Write the failing integration isolation test**

Create a Purchase Order in the first business, assert it's absent from `GET
/api/v1/purchase-orders` after switching to `secondBusinessId`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Add `businessId` to `CreatePurchaseOrderData`, `PurchaseOrderFilters`, and `CreateGoodsReceiptData`**

```typescript
export interface CreatePurchaseOrderData {
  vendorId: string;
  tenderId?: string | null;
  businessId: string;
  sourceRfqId?: string | null;
  expectedDeliveryDate?: Date | null;
  notes?: string | null;
  createdById: string;
  items: CreatePurchaseOrderItemData[];
}
```

`PurchaseOrderFilters` (currently `{ status?, vendorId?, tenderId? }`) becomes `{ businessId:
string; status?; vendorId?; tenderId? }`.

```typescript
export interface CreateGoodsReceiptData {
  purchaseOrderId: string;
  businessId: string;
  receivedById: string;
  receivedDate: Date;
  remarks?: string | null;
  items: CreateGoodsReceiptItemData[];
}
```

- [ ] **Step 4: Update the repository**

`create`'s transaction: add `businessId: data.businessId ?? null` — wait, `businessId` is
required (not optional) on `PurchaseOrder`, so add it as a plain required field:
`businessId: data.businessId` in the `prisma.purchaseOrder.create({ data: {...} })` call.
`findMany`'s `where` gains `businessId: filters.businessId`. `createGoodsReceipt`'s
`prisma.goodsReceipt.create({ data: {...} })` call gains `businessId: data.businessId`. Scope
`getDetailOrThrow`/any `findById` the same way as prior tasks.

- [ ] **Step 5: Update the service**

```typescript
async create(
  input: {
    vendorId: string; tenderId?: string; expectedDeliveryDate?: Date; notes?: string;
    items: Array<{ description: string; unit?: string; quantity: number; rate: number; sortOrder?: number }>;
  },
  actorId: string,
  context: ScopedRequestContext,
): Promise<PurchaseOrderDto> {
  if (input.items.length === 0) throw new BadRequestError("At least one purchase order item is required");
  const vendor = await this.vendorsRepository.findById(input.vendorId);
  if (!vendor) throw new BadRequestError("Invalid vendorId");
  if (input.tenderId) {
    const tender = await this.tendersRepository.findById(input.tenderId, context.businessId);
    if (!tender) throw new BadRequestError("Invalid tenderId");
  }
  const items: CreatePurchaseOrderItemData[] = input.items.map(/* unchanged */);
  const data: CreatePurchaseOrderData = {
    vendorId: input.vendorId,
    tenderId: input.tenderId ?? null,
    businessId: context.businessId,
    expectedDeliveryDate: input.expectedDeliveryDate ?? null,
    notes: input.notes ?? null,
    createdById: actorId,
    items,
  };
  const poId = await this.purchaseOrdersRepository.create(data);
  await this.auditService.log({ actorId, action: "PURCHASE_ORDER_CREATED", entityType: "PurchaseOrder", entityId: poId, ipAddress: context.ipAddress, userAgent: context.userAgent });
  return this.getById(poId, context.businessId);
}
```

Apply the same `businessId` threading to `createFromRfq` (which calls
`purchaseOrdersRepository.create(...)` directly, per the earlier research finding) and to
`listPurchaseOrders`/`getById`.

For `createGoodsReceipt` — this method currently has **no** context/businessId parameter at all
(confirmed in research: `createGoodsReceipt(poId, input, actorId)`). Add one:

```typescript
async createGoodsReceipt(
  poId: string,
  input: CreateGoodsReceiptInput,
  actorId: string,
  businessId: string,
): Promise<PurchaseOrderDto> {
  const po = await this.getDetailOrThrow(poId, businessId);
  if (po.status !== "ISSUED" && po.status !== "PARTIALLY_RECEIVED") throw new ConflictError(/* unchanged */);
  if (input.items.length === 0) throw new BadRequestError("At least one received item is required");
  // ...unchanged quantity validation...
  await this.purchaseOrdersRepository.createGoodsReceipt({
    purchaseOrderId: poId,
    businessId,
    receivedById: actorId,
    receivedDate: input.receivedDate ?? new Date(),
    remarks: input.remarks,
    items: input.items,
  });
  // ...unchanged PO status recompute, audit log...
  return this.getById(poId, businessId);
}
```

- [ ] **Step 6: Update the controller**

Same pattern as prior tasks; the `createGoodsReceipt` controller method additionally passes
`req.user!.businessId` as the new trailing argument.

- [ ] **Step 7: Update the unit test's fake repository**

Same pattern as prior tasks.

- [ ] **Step 8: Run all purchase-orders tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/purchase-orders`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `purchase-orders` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/purchase-orders
git commit -m "feat(server): scope purchase-orders and goods-receipts to businessId"
```

---

### Task 17: Scope the finance module (BankAccount, Invoice, Expense, Payment)

**Files:**
- Modify: `apps/server/src/modules/finance/finance.repository.ts`, `apps/server/src/modules/finance/finance.service.ts`,
  `apps/server/src/modules/finance/finance.controller.ts`
- Test: `apps/server/src/modules/finance/__tests__/finance.service.spec.ts`,
  `apps/server/src/modules/finance/__tests__/finance.integration.spec.ts`

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2).

- [ ] **Step 1: Write the failing integration isolation test**

Create a `BankAccount` in the first business, assert it's absent from `GET
/api/v1/finance/bank-accounts` after switching to `secondBusinessId`. Repeat the same pattern for
one more entity (e.g. `Expense`) to cover both the simple (`BankAccount`) and
project-optionally-linked (`Expense`) cases in one task.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Add `businessId` to all four `Create*Data` interfaces**

```typescript
export interface CreateBankAccountData {
  name: string;
  accountNumber?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  openingBalance?: number;
  businessId: string;
  createdById: string;
}

export interface CreateInvoiceData {
  invoiceNumber: string;
  projectId?: string | null;
  sourceBillId?: string | null;
  clientName: string;
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  totalAmount: number;
  invoiceDate?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  businessId: string;
  createdById: string;
}

export interface CreateExpenseData {
  category: ExpenseCategory;
  description: string;
  amount: number;
  expenseDate?: Date;
  projectId?: string | null;
  vendorId?: string | null;
  notes?: string | null;
  businessId: string;
  createdById: string;
}

export interface CreatePaymentData {
  direction: PaymentDirection;
  amount: number;
  method: PaymentMethod;
  bankAccountId?: string | null;
  referenceNumber?: string | null;
  paymentDate?: Date;
  entityType: string;
  entityId: string;
  remarks?: string | null;
  businessId: string;
  recordedById: string;
}
```

- [ ] **Step 4: Update the four repository `create*` methods**

Each already spreads `...data` into the Prisma `create` call (`createBankAccount`,
`createInvoice`, `createExpense`, `createPayment` — all shown in the earlier research as
`this.prisma.<model>.create({ data: { id, ...data } })` or `{ id: randomUUID(), ...data }`), so
`businessId` flows through automatically once it's part of each `Create*Data` type — no method
body changes needed here. Scope every `findMany`/`findById`-equivalent read method for
`BankAccount`/`Invoice`/`Expense`/`Payment` by adding `businessId` to their filter/`where`
objects, following the same pattern as every prior task.

- [ ] **Step 5: Update the service**

Update `createBankAccount`, `createInvoice`, `createExpense` to take `context:
ScopedRequestContext` and pass `businessId: context.businessId` into their repository `create*`
call. `validateAndCreatePayment` (the private helper backing all payment recording) gains a
`businessId: string` field on its `params` object, threaded from each of its three public
callers (`recordInvoicePayment`/`recordExpensePayment`/`recordPurchaseOrderPayment`), each of
which already receives a `context`/`businessId` from its own controller call — plumb it through
one more layer into `validateAndCreatePayment`'s `financeRepository.createPayment({ ...,
businessId: params.businessId })` call.

Also scope `sumPaymentsForEntity` (used inside `validateAndCreatePayment` to check the running
total) — this currently sums payments by `entityType`/`entityId` alone; add `businessId` to its
`where` too, since without it a payment recorded against the same `entityId` value colliding
across businesses (unlikely given UUIDs, but the entityId/entityType pair is an unenforced
generic reference per this schema's existing convention) could otherwise pollute the sum.

- [ ] **Step 6: Update the controller**

Same pattern as prior tasks for all create/list endpoints across `BankAccount`/`Invoice`/
`Expense`/payment-recording routes.

- [ ] **Step 7: Update the unit test's fake repository**

Same pattern as prior tasks — extend `FakeFinanceRepository` (or however the existing fake is
named) to accept `businessId` on all four create methods and the new `sumPaymentsForEntity`
signature.

- [ ] **Step 8: Run all finance tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/finance`
Expected: PASS

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `finance` module.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/modules/finance
git commit -m "feat(server): scope finance module (bank accounts, invoices, expenses, payments) to businessId"
```

---

### Task 18: Scope the rates module (HistoricalRate)

**Files:**
- Modify: `apps/server/src/modules/rates/rates.repository.ts`, `apps/server/src/modules/rates/rates.service.ts`
  (confirm exact service filename via `find apps/server/src/modules/rates -name "*.ts"` — module
  name inferred from the repository path found during research; controller/routes/module files
  follow the same convention), and its controller
- Test: whatever `__tests__` files exist under `apps/server/src/modules/rates/`

**Interfaces:**
- Consumes: `ScopedRequestContext` (Task 2).

Per the design doc's revision (historical rates are per-business, not shared — cross-business
lookups are explicit future work), this module gets the same treatment as every other scoped
module, using `req.user!.businessId` directly (never derived from `sourceTenderId`, which is an
unenforced, optional reference — not a real relation).

- [ ] **Step 1: Write the failing integration isolation test**

Create a `HistoricalRate` in the first business, assert it's absent from the rates list/search
endpoint after switching to `secondBusinessId`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL

- [ ] **Step 3: Add `businessId` to `CreateHistoricalRateData`**

```typescript
export interface CreateHistoricalRateData {
  category: HistoricalRateCategory;
  itemName: string;
  unit: string;
  rate: number;
  location?: string | null;
  effectiveDate: Date;
  sourceTenderId?: string | null;
  notes?: string | null;
  businessId: string;
  createdById: string;
}
```

- [ ] **Step 4: Update `create` and list/search methods**

```typescript
create(data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator> {
  return this.prisma.historicalRate.create({
    data: { id: randomUUID(), ...data },
    ...historicalRateArgs,
  });
}
```

(No structural change needed — `businessId` flows through the spread once it's part of the
input type.) Add `businessId` to whatever list/search method exists (find it via `grep -n
"findMany\|search" apps/server/src/modules/rates/rates.repository.ts`), following the same
unconditional-`where`-field pattern as every prior task.

- [ ] **Step 5: Update the service and controller**

Same pattern as every prior task — service methods take `ScopedRequestContext` (or a plain
`businessId` parameter for read paths), controller passes `req.user!.businessId`.

- [ ] **Step 6: Update tests**

Same pattern as every prior task — fake repository accepts/ignores `businessId`; new isolation
test in the integration spec.

- [ ] **Step 7: Run all rates tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/rates`
Expected: PASS

- [ ] **Step 8: Typecheck the whole server package**

Run: `pnpm --filter @bmp/server typecheck`
Expected: PASS with **zero** remaining errors — every scoped module has now been retrofitted, so
this is the first point in the plan where the full server package should typecheck cleanly.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/rates
git commit -m "feat(server): scope historical rates to businessId"
```

---

### Task 19: Scope the reports module

**Files:**
- Modify: `apps/server/src/modules/reports/reports.repository.ts`, `apps/server/src/modules/reports/reports.service.ts`,
  `apps/server/src/modules/reports/reports.controller.ts`
- Test: `apps/server/src/modules/reports/__tests__/reports.service.spec.ts`,
  `apps/server/src/modules/reports/__tests__/reports.integration.spec.ts`

**Interfaces:**
- Consumes: `req.user!.businessId` (Task 3).

The reports module doesn't reuse the entity repositories from Tasks 12-18 — it has its own
`ReportsRepository` that queries Prisma models directly for dashboard aggregation. None of its
20 methods filter by `businessId` today, and its two-tier Redis cache (`cached("reports:kpis",
...)`-style keys) is **not** namespaced by business either — meaning that even a query fixed to
filter by `businessId` would still return the *first business's* cached result to every business
for the life of the cache TTL. Both issues need fixing in this task; neither is caught by Task
20's Prisma Client extension (some of these queries target unscoped child tables like
`PurchaseOrderItem`/`VendorRating` via a nested relation filter rather than a top-level scoped
model, which the guard doesn't inspect).

- [ ] **Step 1: Write the failing integration isolation test**

Add to `reports.integration.spec.ts` (using the Task 11 helper's `businessId`/`secondBusinessId`):

```typescript
  it("does not include another business's tenders in the pipeline report or KPIs", async () => {
    await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ /* same payload as this file's existing tender-creation setup */ });

    const otherLogin = await request(app).post("/api/v1/auth/login").send({ email: testUser.email, password: "Password123" });
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
      .send({ businessId: testUser.secondBusinessId });
    const secondBusinessToken = switchResponse.body.data.accessToken as string;

    const pipelineResponse = await request(app)
      .get("/api/v1/reports/tender-pipeline")
      .set("Authorization", `Bearer ${secondBusinessToken}`);

    expect(pipelineResponse.body.data.totalTenders).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports/__tests__/reports.integration.spec.ts`
Expected: FAIL — `totalTenders` includes the first business's tender.

- [ ] **Step 3: Rewrite the repository**

Every method gains a leading `businessId: string` parameter (or, for the four methods that take
an id list, it's added alongside). Filtering strategy depends on which model each method queries
directly: `Tender`, `Project`, `Boq`, `PurchaseOrder`, `GoodsReceipt`, `Invoice`, `Payment` are
themselves in `SCOPED_MODELS` (Task 20) and take `businessId` at the top level of `where`;
`PurchaseOrderItem`, `ProjectLaborEntry`, and `VendorRating` are child/unscoped tables and need a
**nested** `businessId` filter through their scoped parent relation (`purchaseOrder: {
businessId }`, `project: { businessId }`). `Vendor` and `Organization` stay unfiltered (global).

```typescript
// apps/server/src/modules/reports/reports.repository.ts
import type { PrismaClient, TenderStatus } from "@bmp/database";

export interface PurchaseOrderSpendRow {
  amount: number;
  vendorId: string;
  vendorName: string;
  poCreatedAt: Date;
}

export interface ProjectBasicRow {
  id: string;
  name: string;
  status: string;
  budget: number;
  tenderId: string;
}

export interface PaymentBasicRow {
  direction: "RECEIVED" | "PAID";
  amount: number;
  paymentDate: Date;
}

export interface PurchaseOrderForOnTimeRow {
  id: string;
  vendorId: string;
  expectedDeliveryDate: Date | null;
}

export interface IReportsRepository {
  findTenderStatusCounts(businessId: string): Promise<{ status: TenderStatus; count: number }[]>;
  findTenderDates(businessId: string): Promise<{ createdAt: Date; submissionDate: Date }[]>;

  findPurchaseOrderItemsForSpend(businessId: string, from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]>;

  findActiveProjectsBasic(businessId: string): Promise<ProjectBasicRow[]>;
  findPurchaseOrderTotalsByTenderIds(
    businessId: string,
    tenderIds: string[],
  ): Promise<{ tenderId: string; amount: number }[]>;
  findLaborTotalsByProjectIds(businessId: string, projectIds: string[]): Promise<{ projectId: string; amount: number }[]>;

  findPaymentsForSummary(businessId: string, from?: Date, to?: Date): Promise<PaymentBasicRow[]>;

  findVendorsBasic(): Promise<{ id: string; name: string }[]>;
  findVendorRatings(businessId: string): Promise<{ vendorId: string; rating: number }[]>;
  findPurchaseOrdersForOnTimeCalc(businessId: string): Promise<PurchaseOrderForOnTimeRow[]>;
  findLatestGoodsReceiptDatesByPoIds(businessId: string, poIds: string[]): Promise<{ purchaseOrderId: string; receivedDate: Date }[]>;
  countPurchaseOrdersByVendor(businessId: string): Promise<{ vendorId: string; count: number }[]>;

  findAllInvoiceTotals(businessId: string): Promise<{ totalAmount: number; invoiceDate: Date }[]>;
  sumPaymentsByEntityType(businessId: string, entityType: string): Promise<number>;

  findGoodsReceiptLeadTimes(businessId: string): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]>;
  findBoqCreationLeadTimes(businessId: string): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]>;

  searchTenders(businessId: string, query: string): Promise<{ id: string; tenderNumber: string; title: string }[]>;
  searchOrganizations(query: string): Promise<{ id: string; name: string }[]>;
  searchVendors(query: string): Promise<{ id: string; name: string }[]>;
  searchProjects(businessId: string, query: string): Promise<{ id: string; name: string }[]>;
}

const SEARCH_LIMIT = 5;

export class ReportsRepository implements IReportsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenderStatusCounts(businessId: string): Promise<{ status: TenderStatus; count: number }[]> {
    const groups = await this.prisma.tender.groupBy({ where: { businessId }, by: ["status"], _count: { _all: true } });
    return groups.map((g) => ({ status: g.status, count: g._count._all }));
  }

  findTenderDates(businessId: string): Promise<{ createdAt: Date; submissionDate: Date }[]> {
    return this.prisma.tender.findMany({ where: { businessId }, select: { createdAt: true, submissionDate: true } });
  }

  async findPurchaseOrderItemsForSpend(businessId: string, from?: Date, to?: Date): Promise<PurchaseOrderSpendRow[]> {
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          businessId,
          createdAt: from || to ? { gte: from, lte: to } : undefined,
        },
      },
      select: {
        amount: true,
        purchaseOrder: {
          select: { createdAt: true, vendor: { select: { id: true, name: true } } },
        },
      },
    });
    return items.map((item) => ({
      amount: item.amount,
      vendorId: item.purchaseOrder.vendor.id,
      vendorName: item.purchaseOrder.vendor.name,
      poCreatedAt: item.purchaseOrder.createdAt,
    }));
  }

  findActiveProjectsBasic(businessId: string): Promise<ProjectBasicRow[]> {
    return this.prisma.project.findMany({
      where: { businessId, status: { in: ["ACTIVE", "ON_HOLD"] } },
      select: { id: true, name: true, status: true, budget: true, tenderId: true },
    });
  }

  async findPurchaseOrderTotalsByTenderIds(
    businessId: string,
    tenderIds: string[],
  ): Promise<{ tenderId: string; amount: number }[]> {
    if (tenderIds.length === 0) return [];
    const items = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          businessId,
          tenderId: { in: tenderIds },
          status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] },
        },
      },
      select: { amount: true, purchaseOrder: { select: { tenderId: true } } },
    });
    return items.map((item) => ({ tenderId: item.purchaseOrder.tenderId!, amount: item.amount }));
  }

  async findLaborTotalsByProjectIds(
    businessId: string,
    projectIds: string[],
  ): Promise<{ projectId: string; amount: number }[]> {
    if (projectIds.length === 0) return [];
    return this.prisma.projectLaborEntry.findMany({
      where: { projectId: { in: projectIds }, project: { businessId } },
      select: { projectId: true, amount: true },
    });
  }

  findPaymentsForSummary(businessId: string, from?: Date, to?: Date): Promise<PaymentBasicRow[]> {
    return this.prisma.payment.findMany({
      where: { businessId, paymentDate: from || to ? { gte: from, lte: to } : undefined },
      select: { direction: true, amount: true, paymentDate: true },
    });
  }

  findVendorsBasic(): Promise<{ id: string; name: string }[]> {
    return this.prisma.vendor.findMany({ select: { id: true, name: true } });
  }

  findVendorRatings(businessId: string): Promise<{ vendorId: string; rating: number }[]> {
    return this.prisma.vendorRating.findMany({
      where: { purchaseOrder: { businessId } },
      select: { vendorId: true, rating: true },
    });
  }

  findPurchaseOrdersForOnTimeCalc(businessId: string): Promise<PurchaseOrderForOnTimeRow[]> {
    return this.prisma.purchaseOrder.findMany({
      where: { businessId, expectedDeliveryDate: { not: null } },
      select: { id: true, vendorId: true, expectedDeliveryDate: true },
    });
  }

  findLatestGoodsReceiptDatesByPoIds(
    businessId: string,
    poIds: string[],
  ): Promise<{ purchaseOrderId: string; receivedDate: Date }[]> {
    if (poIds.length === 0) return Promise.resolve([]);
    return this.prisma.goodsReceipt.findMany({
      where: { businessId, purchaseOrderId: { in: poIds } },
      orderBy: { receivedDate: "desc" },
      select: { purchaseOrderId: true, receivedDate: true },
    });
  }

  async countPurchaseOrdersByVendor(businessId: string): Promise<{ vendorId: string; count: number }[]> {
    const groups = await this.prisma.purchaseOrder.groupBy({ where: { businessId }, by: ["vendorId"], _count: { _all: true } });
    return groups.map((g) => ({ vendorId: g.vendorId, count: g._count._all }));
  }

  findAllInvoiceTotals(businessId: string): Promise<{ totalAmount: number; invoiceDate: Date }[]> {
    return this.prisma.invoice.findMany({ where: { businessId }, select: { totalAmount: true, invoiceDate: true } });
  }

  async sumPaymentsByEntityType(businessId: string, entityType: string): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: { businessId, entityType },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  findGoodsReceiptLeadTimes(businessId: string): Promise<{ purchaseOrderCreatedAt: Date; receivedDate: Date }[]> {
    return this.prisma.goodsReceipt
      .findMany({
        where: { businessId },
        select: { receivedDate: true, purchaseOrder: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ purchaseOrderCreatedAt: r.purchaseOrder.createdAt, receivedDate: r.receivedDate })));
  }

  findBoqCreationLeadTimes(businessId: string): Promise<{ tenderCreatedAt: Date; boqCreatedAt: Date }[]> {
    return this.prisma.boq
      .findMany({
        where: { businessId, isCurrent: true },
        select: { createdAt: true, tender: { select: { createdAt: true } } },
      })
      .then((rows) => rows.map((r) => ({ tenderCreatedAt: r.tender.createdAt, boqCreatedAt: r.createdAt })));
  }

  searchTenders(businessId: string, query: string): Promise<{ id: string; tenderNumber: string; title: string }[]> {
    return this.prisma.tender.findMany({
      where: {
        businessId,
        OR: [
          { tenderNumber: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, tenderNumber: true, title: true },
      take: SEARCH_LIMIT,
    });
  }

  searchOrganizations(query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.organization.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }

  searchVendors(query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.vendor.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }

  searchProjects(businessId: string, query: string): Promise<{ id: string; name: string }[]> {
    return this.prisma.project.findMany({
      where: { businessId, name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true },
      take: SEARCH_LIMIT,
    });
  }
}
```

- [ ] **Step 4: Thread `businessId` through the service, and namespace every cache key by it**

Every public `get*`/`search` method on `ReportsService` gains a leading `businessId: string`
parameter, forwarded to its repository calls, **and** every `cached(key, ...)` call's key gets a
`:${businessId}` suffix — this is the fix for the cross-business cache leak described above.
`getTenderPipeline`/`getVendorPerformance`/`getKpis` (the three cached ones) change from:

```typescript
  async getTenderPipeline(): Promise<TenderPipelineReportDto> {
    return cached("reports:tender-pipeline", () => this.computeTenderPipeline());
  }
```

to:

```typescript
  async getTenderPipeline(businessId: string): Promise<TenderPipelineReportDto> {
    return cached(`reports:tender-pipeline:${businessId}`, () => this.computeTenderPipeline(businessId));
  }
```

(and likewise `computeTenderPipeline(businessId: string)` forwards it into both repository
calls it makes). Apply the identical `businessId` parameter + cache-key-suffix pattern to
`getVendorPerformance`/`computeVendorPerformance` and `getKpis`/`computeKpis`. For the
non-cached methods (`getProcurementSpend`, `getProjectCosting`, `getFinancialSummary`, `search`,
`getExportableTable`), just add the leading `businessId` parameter and forward it into each
repository call — no cache key involved. `getExportableTable`'s internal `switch` calls (e.g.
`this.getTenderPipeline()`) become `this.getTenderPipeline(businessId)`, forwarding the same
parameter it now itself receives.

- [ ] **Step 5: Update the controller**

Every controller method adds `req.user!.businessId` as the first argument to its
`reportsService.*` call, e.g.:

```typescript
  getTenderPipeline = asyncHandler(async (req, res) => {
    const report = await this.reportsService.getTenderPipeline(req.user!.businessId);
    sendSuccess(res, report, "Tender pipeline report retrieved");
  });
```

(change the unused `_req` parameter to `req` wherever a method previously ignored it, since it
now needs `req.user!.businessId`). Apply the same one-line change to `getProcurementSpend`,
`getProjectCosting`, `getFinancialSummary`, `getVendorPerformance`, `getKpis`, `search`, and
`exportReport` (whose `getExportableTable(reportKey, from, to)` call becomes
`getExportableTable(req.user!.businessId, reportKey, from, to)` — update `getExportableTable`'s
parameter order in the service to match, `businessId` first).

- [ ] **Step 6: Update the unit test's fake repository**

In `reports.service.spec.ts`, update the fake `IReportsRepository` implementation's method
signatures to accept (and ignore, per this plan's established pattern) the new leading
`businessId` parameter on every method that gained one.

- [ ] **Step 7: Run the reports tests**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reports`
Expected: PASS, including the new isolation test from Step 1.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no remaining errors in the `reports` module.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/reports
git commit -m "feat(server): scope reports module to businessId, including cache keys"
```

---

### Task 20: Prisma Client extension — defense-in-depth `businessId` enforcement

**Files:**
- Create: `apps/server/src/infra/prisma/scoped-client.ts`
- Modify: `apps/server/src/infra/prisma/client.ts`
- Test: `apps/server/src/infra/prisma/__tests__/scoped-client.spec.ts`

**Interfaces:**
- Consumes: the final Prisma client instance from `apps/server/src/infra/prisma/client.ts`.
- Produces: a query-time guard that throws if a scoped-model query is executed with no
  `businessId` anywhere in its `where` clause.

This is a safety net, not the primary enforcement mechanism (Tasks 12-19 already filter
explicitly) — it exists so a *future* repository method that forgets the filter fails loudly in
tests/dev instead of silently leaking data across businesses.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/infra/prisma/__tests__/scoped-client.spec.ts
import { describe, expect, it } from "vitest";

import { SCOPED_MODELS, assertBusinessScoped } from "../scoped-client.js";

describe("assertBusinessScoped", () => {
  it("throws when a scoped model's where clause has no businessId", () => {
    expect(() => assertBusinessScoped("Tender", { status: "DRAFT" })).toThrow(/businessId/);
  });

  it("passes when businessId is present at the top level", () => {
    expect(() => assertBusinessScoped("Tender", { businessId: "b1", status: "DRAFT" })).not.toThrow();
  });

  it("passes when businessId is present inside an AND clause", () => {
    expect(() =>
      assertBusinessScoped("Tender", { AND: [{ businessId: "b1" }, { status: "DRAFT" }] }),
    ).not.toThrow();
  });

  it("ignores non-scoped models entirely", () => {
    expect(() => assertBusinessScoped("Vendor", { name: "Acme" })).not.toThrow();
  });

  it("lists exactly the 11 scoped model names", () => {
    expect(SCOPED_MODELS).toEqual(
      new Set([
        "Tender", "Project", "Boq", "Rfq", "PurchaseOrder", "GoodsReceipt",
        "BankAccount", "Invoice", "Expense", "Payment", "HistoricalRate",
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/infra/prisma/__tests__/scoped-client.spec.ts`
Expected: FAIL — `../scoped-client.js` doesn't exist yet.

- [ ] **Step 3: Write the extension**

```typescript
// apps/server/src/infra/prisma/scoped-client.ts
import type { Prisma, PrismaClient } from "@bmp/database";

export const SCOPED_MODELS = new Set([
  "Tender",
  "Project",
  "Boq",
  "Rfq",
  "PurchaseOrder",
  "GoodsReceipt",
  "BankAccount",
  "Invoice",
  "Expense",
  "Payment",
  "HistoricalRate",
]);

const READ_ACTIONS = new Set(["findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);

function whereContainsBusinessId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const clause = where as Record<string, unknown>;
  if ("businessId" in clause) return true;
  for (const key of ["AND", "OR"] as const) {
    const nested = clause[key];
    if (Array.isArray(nested) && nested.some((entry) => whereContainsBusinessId(entry))) return true;
  }
  return false;
}

export function assertBusinessScoped(model: string, where: unknown): void {
  if (!SCOPED_MODELS.has(model)) return;
  if (!whereContainsBusinessId(where)) {
    throw new Error(
      `Refusing to run a ${model} query with no businessId in its where clause — every read/update/delete against a business-scoped model must filter by businessId.`,
    );
  }
}

export function withBusinessScopeGuard(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && READ_ACTIONS.has(operation)) {
            assertBusinessScoped(model, (args as { where?: unknown }).where);
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
```

`create`/`createMany` are deliberately excluded from `READ_ACTIONS` — a create's scoping
correctness is that `businessId` is present in its `data`, not a `where` clause; that's already
enforced by every `Create*Data` interface requiring the field (Tasks 12-19), and a Prisma
`create` call without the required field fails to typecheck, which is a stronger guarantee than
a runtime check could add.

- [ ] **Step 4: Wire the extension into the shared Prisma client**

In `apps/server/src/infra/prisma/client.ts`, find where `prisma` is exported (likely `export
const prisma = new PrismaClient(...)`) and wrap it:

```typescript
import { withBusinessScopeGuard } from "./scoped-client.js";

export const prisma = withBusinessScopeGuard(new PrismaClient(/* unchanged options */));
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @bmp/server exec vitest run src/infra/prisma/__tests__/scoped-client.spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full server test suite to confirm no regressions**

Run: `pnpm --filter @bmp/server exec vitest run src/modules`
Expected: PASS — every module's repository already filters explicitly (Tasks 12-19), so wrapping
the client shouldn't trip the guard on any legitimate query. If any test fails here, it means a
scoped-model read somewhere was missed in Phase C — fix it there, not by weakening the guard.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/infra/prisma/scoped-client.ts apps/server/src/infra/prisma/client.ts apps/server/src/infra/prisma/__tests__/scoped-client.spec.ts
git commit -m "feat(server): add Prisma Client extension guarding scoped models against missing businessId filters"
```

---

## Phase D — Frontend

### Task 21: Auth store — active business and switcher list

**Files:**
- Modify: `apps/web/src/lib/auth-store.ts`

**Interfaces:**
- Produces: `useAuthStore().activeBusinessId`, `useAuthStore().availableBusinesses`,
  `useAuthStore().setAuth(...)` (extended to accept these).

- [ ] **Step 1: Extend the store**

```typescript
import type { UserDto } from "@bmp/types";
import { create } from "zustand";

export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
}

interface AuthState {
  accessToken: string | null;
  user: UserDto | null;
  activeBusinessId: string | null;
  availableBusinesses: AvailableBusiness[];
  isInitializing: boolean;
  setAuth: (params: {
    accessToken: string;
    user?: UserDto;
    activeBusinessId?: string;
    availableBusinesses?: AvailableBusiness[];
  }) => void;
  setUser: (user: UserDto) => void;
  clearAuth: () => void;
  setInitializing: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  activeBusinessId: null,
  availableBusinesses: [],
  isInitializing: true,
  setAuth: ({ accessToken, user, activeBusinessId, availableBusinesses }) =>
    set((state) => ({
      accessToken,
      user: user ?? state.user,
      activeBusinessId: activeBusinessId ?? state.activeBusinessId,
      availableBusinesses: availableBusinesses ?? state.availableBusinesses,
    })),
  setUser: (user) => set({ user }),
  clearAuth: () => set({ accessToken: null, user: null, activeBusinessId: null, availableBusinesses: [] }),
  setInitializing: (value) => set({ isInitializing: value }),
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
```

- [ ] **Step 2: Locate and update the login/refresh call sites that populate the store**

Run: `grep -rn "setAuth(" apps/web/src` — find every call site (login page, axios refresh
interceptor, app-init bootstrap). The login response now needs to also return
`activeBusinessId`/`availableBusinesses` — check `packages/types/src/api.ts` (or wherever
`LoginResponseDto` is defined) for where to add these two fields, matching the backend's
`AuthService.login()` return shape from Task 8 (`active.businessId` plus a list from
`businessesRepository.listUserBusinesses(user.id)`, which the backend's `login()` should also
call and include in its response — if it doesn't yet, add that call in `auth.service.ts`
alongside `resolveActiveBusiness`, since Task 8 focused on the JWT claim but the HTTP response
body also needs the switcher list). Update every `setAuth(...)` call site to pass these two new
fields through from the login/refresh/switch-business response.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/web typecheck` (only if the dev server is stopped — see this repo's
documented `.next` race-condition gotcha)
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth-store.ts
git commit -m "feat(web): store activeBusinessId and available businesses in auth store"
```

---

### Task 22: Business switcher in the topbar

**Files:**
- Modify: `apps/web/src/components/layout/topbar.tsx`
- Create: `apps/web/src/hooks/use-switch-business.ts`

**Interfaces:**
- Consumes: `useAuthStore().activeBusinessId`/`availableBusinesses` (Task 21),
  `POST /auth/switch-business` (Task 9).

- [ ] **Step 1: Write the mutation hook**

```typescript
// apps/web/src/hooks/use-switch-business.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/axios.js";
import { useAuthStore } from "../lib/auth-store.js";

export function useSwitchBusiness() {
  const queryClient = useQueryClient();
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: async (businessId: string) => {
      const response = await apiClient.post("/auth/switch-business", { businessId });
      return response.data.data as { accessToken: string; accessTokenExpiresAt: string };
    },
    onSuccess: async (data, businessId) => {
      setAuth({ accessToken: data.accessToken, activeBusinessId: businessId });
      await queryClient.clear();
    },
  });
}
```

- [ ] **Step 2: Add the switcher UI to the topbar**

In `apps/web/src/components/layout/topbar.tsx`, inside the existing `<div className="flex
items-center gap-2">` block (right before `<NotificationBell />`), add — reusing the same
`DropdownMenu` primitives already imported for the user-avatar menu:

```tsx
{availableBusinesses.length > 1 ? (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm">
        {availableBusinesses.find((b) => b.businessId === activeBusinessId)?.businessName ?? "Select business"}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuLabel>Switch business</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {availableBusinesses.map((business) => (
        <DropdownMenuItem
          key={business.businessId}
          disabled={business.businessId === activeBusinessId || switchBusiness.isPending}
          onClick={() => switchBusiness.mutate(business.businessId)}
        >
          {business.businessName}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
) : null}
```

Add `const { activeBusinessId, availableBusinesses } = useAuthStore();` and `const
switchBusiness = useSwitchBusiness();` near the top of the component, and import `Button` from
`@bmp/ui` and `useSwitchBusiness` from `../../hooks/use-switch-business.js` alongside the file's
existing imports.

- [ ] **Step 3: Manually verify in the browser**

Run: `pnpm dev`, then log in as `superadmin@bmp.local` / `ChangeMe123!` and confirm the switcher
appears (2 businesses) and switching reloads the Tenders list scoped to the new business; log in
as `tender.manager@bmp.local` and confirm the switcher does **not** appear (single business).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/topbar.tsx apps/web/src/hooks/use-switch-business.ts
git commit -m "feat(web): add business switcher to topbar"
```

---

### Task 23: Businesses admin page

**Files:**
- Create: `apps/web/src/hooks/use-businesses.ts`
- Create: `apps/web/src/app/(dashboard)/businesses/page.tsx`

**Interfaces:**
- Consumes: `/businesses` CRUD + membership endpoints (Task 6/7).

- [ ] **Step 1: Write the TanStack Query hooks**

```typescript
// apps/web/src/hooks/use-businesses.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../lib/axios.js";

export interface Business {
  id: string;
  name: string;
  code: string;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: string | null;
  isActive: boolean;
  tenderCount: number;
}

export function useBusinesses() {
  return useQuery({
    queryKey: ["businesses"],
    queryFn: async () => {
      const response = await apiClient.get("/businesses");
      return response.data.data as { items: Business[]; totalItems: number };
    },
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; code: string }) => {
      const response = await apiClient.post("/businesses", data);
      return response.data.data as Business;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["businesses"] }),
  });
}
```

- [ ] **Step 2: Write the page**

Follow this repo's existing list-page pattern (check `apps/web/src/app/(dashboard)/organizations/page.tsx`
for the exact structure to mirror — table, create dialog, permission gate) and build
`apps/web/src/app/(dashboard)/businesses/page.tsx` using `useBusinesses()`/`useCreateBusiness()`,
gated with `hasPermission(user?.role.name, "businesses:read")` for viewing and
`hasPermission(user?.role.name, "businesses:create")` for the create action, using `@bmp/ui`'s
`DataTable` component (same one used by Organizations/Tenders lists) to render `name`, `code`,
`tenderCount`, `isActive` columns.

- [ ] **Step 3: Manually verify in the browser**

Run: `pnpm dev`, log in as `superadmin@bmp.local`, navigate to `/businesses`, confirm both seeded
businesses appear and a new one can be created. Log in as `tender.manager@bmp.local` and confirm
the page (or nav link to it) is hidden/forbidden, since that role has no `businesses:read`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/hooks/use-businesses.ts "apps/web/src/app/(dashboard)/businesses"
git commit -m "feat(web): add Businesses admin page"
```

---

## Final verification

- [ ] Run the full test suite: `pnpm test` — expect all unit and integration tests passing.
- [ ] Run the full typecheck: `pnpm typecheck` (server first, then web, per this repo's
  documented `.next` race-condition gotcha — never run both via a single `turbo run` invocation
  while `pnpm dev` is also running).
- [ ] Run `graphify update .` to refresh the knowledge graph now that ~11 modules (tenders,
  projects, boq, rfq, purchase-orders, finance, rates, reports, users, auth, businesses) have
  changed.
- [ ] Manually walk through: log in as `superadmin@bmp.local`, switch between Archie Udyog and
  Samson Industries, confirm tenders/projects/finance data is fully separate between them; log
  in as a single-business seeded user and confirm no switcher appears and all data is scoped to
  their one business.
