# Theme Color Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user pick a curated accent color per business membership (Chrome-style swatch grid), applied instantly and persisted server-side.

**Architecture:** One new column (`UserBusiness.themeColor`) piggybacks on the existing per-membership row. The value rides along on data the frontend already fetches (`AvailableBusiness` from login/refresh/switch-business) — no new read endpoint. A single self-scoped write endpoint (`PATCH /users/me/theme-color`) follows the codebase's existing own-profile convention. Frontend applies the color by writing 3 CSS custom properties (`--primary`, `--primary-foreground`, `--ring`) onto `<html>`, re-derived whenever the active business or light/dark mode changes.

**Tech Stack:** Prisma/Postgres, Express + Zod, Next.js/React 19, Zustand, TanStack Query, `next-themes`.

## Global Constraints

- Follow the module convention exactly: `*.repository.ts` / `*.service.ts` / `*.controller.ts` / `*.routes.ts` / `*.validation.ts` (see `apps/server/src/modules/users/*`).
- Self-scoped routes (own profile/avatar) skip `requirePermission` — ownership is checked in the service. This new route follows that same pattern.
- Vitest, not Jest. Unit tests use hand-written fake repositories (no mocking framework).
- Don't run `pnpm --filter @bmp/web typecheck` or `build` while `pnpm dev`'s Next dev server is running — both write to `apps/web/.next` and race (see CLAUDE.md gotcha). Stop the dev server first, or run `typecheck` then restart dev after.
- Numeric/string form fields follow existing React Hook Form conventions where relevant (not applicable here — no numeric input in this feature).
- Migration: use `pnpm db:migrate` from repo root; when prompted for a migration name, enter exactly `add_theme_color_to_user_business`.

---

## File Structure

**New files:**
- `packages/types/src/theme.ts` — `THEME_COLOR_KEYS` const array + `ThemeColorKey` type (shared by backend zod validation and frontend palette).
- `apps/web/src/lib/theme-colors.ts` — palette (HSL values per key, light+dark) + `applyThemeColorVars()` + `cacheThemeColorVars()`/`readCachedThemeColorVars()` helpers.
- `apps/web/src/lib/theme-colors.spec.ts` — unit tests for the palette lookup.
- `apps/web/src/components/profile/theme-color-picker.tsx` — the swatch-grid component.

**Modified files:**
- `packages/database/prisma/schema.prisma` — add `themeColor` column to `UserBusiness`.
- `packages/types/src/auth.ts` — `AvailableBusiness` gains `themeColor`.
- `packages/types/src/user.ts` — new `UpdateThemeColorInput`.
- `packages/types/src/index.ts` — barrel-export the new `theme.ts`.
- `apps/server/src/modules/users/users.repository.ts` — new `updateThemeColor` method.
- `apps/server/src/modules/users/users.service.ts` — new `updateThemeColor` method (ownership check + audit log).
- `apps/server/src/modules/users/users.validation.ts` — new `updateThemeColorSchema`.
- `apps/server/src/modules/users/users.controller.ts` — new `updateThemeColor` handler.
- `apps/server/src/modules/users/users.routes.ts` — new `PATCH /me/theme-color` route.
- `apps/server/src/modules/users/__tests__/users.service.spec.ts` — fixture fallout fix + new test cases.
- `apps/server/src/modules/auth/__tests__/auth.service.spec.ts` — fixture fallout fix only.
- `apps/server/src/modules/businesses/businesses.repository.ts` — `listUserBusinesses` return type gains `themeColor`.
- `apps/web/src/lib/auth-store.ts` — new `updateBusinessThemeColor` action.
- `apps/web/src/hooks/use-users.ts` — new `useUpdateThemeColor` hook.
- `apps/web/src/app/layout.tsx` — inline pre-hydration script.
- `apps/web/src/app/(dashboard)/layout.tsx` — sync effect that applies the active business's color.
- `apps/web/src/app/(dashboard)/profile/page.tsx` — render `ThemeColorPicker` per membership.
- `apps/server/src/modules/users/__tests__/users.integration.spec.ts` — new file, integration test for the endpoint.

---

### Task 1: Schema + shared color keys

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (UserBusiness model, currently lines 173-188)
- Create: `packages/types/src/theme.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `apps/server/src/modules/users/__tests__/users.service.spec.ts:38` (fixture fallout)
- Modify: `apps/server/src/modules/auth/__tests__/auth.service.spec.ts:38` (fixture fallout)

**Interfaces:**
- Produces: `THEME_COLOR_KEYS: readonly string[]` and `type ThemeColorKey` from `@bmp/types`, used by Task 2 (backend validation) and Task 6 (frontend palette).
- Produces: `UserBusiness.themeColor` column (Prisma), default `"steel"`, used by every later task.

- [ ] **Step 1: Add the column to the schema**

In `packages/database/prisma/schema.prisma`, change the `UserBusiness` model from:

```prisma
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

to:

```prisma
model UserBusiness {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Restrict)

  themeColor String @default("steel")

  createdAt DateTime @default(now())

  @@unique([userId, businessId])
  @@index([businessId])
  @@index([roleId])
  @@map("user_businesses")
}
```

- [ ] **Step 2: Run the migration**

Run from repo root:

```bash
pnpm db:migrate
```

When prompted `Enter a name for the new migration:`, type `add_theme_color_to_user_business` and press enter.

Expected: a new folder under `packages/database/prisma/migrations/` (timestamp-prefixed, suffix `_add_theme_color_to_user_business`) containing `ALTER TABLE "user_businesses" ADD COLUMN "themeColor" TEXT NOT NULL DEFAULT 'steel';`, and the command exits 0.

- [ ] **Step 3: Add the shared color-key list**

Create `packages/types/src/theme.ts`:

```ts
export const THEME_COLOR_KEYS = [
  "steel",
  "blue",
  "green",
  "violet",
  "amber",
  "rose",
  "teal",
  "slate",
  "indigo",
  "orange",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
```

- [ ] **Step 4: Barrel-export it**

In `packages/types/src/index.ts`, add the line (keep alphabetical order — between `tender.js` and `user.js`):

```ts
export * from "./tender.js";
export * from "./theme.js";
export * from "./user.js";
```

- [ ] **Step 5: Fix fixture fallout in users.service.spec.ts**

The Prisma client now includes `themeColor` on every `UserBusiness` row, so the hand-built test fixture's return type no longer matches without it. In `apps/server/src/modules/users/__tests__/users.service.spec.ts`, change:

```ts
function membershipFor(
  userId: string,
  businessId: string,
  roleId: string,
  now: Date = new Date(),
): UserWithRole["userBusinesses"][number] {
  return { id: randomUUID(), userId, businessId, roleId, role: roleFor(roleId, now), createdAt: now };
}
```

to:

```ts
function membershipFor(
  userId: string,
  businessId: string,
  roleId: string,
  now: Date = new Date(),
  themeColor = "steel",
): UserWithRole["userBusinesses"][number] {
  return { id: randomUUID(), userId, businessId, roleId, role: roleFor(roleId, now), themeColor, createdAt: now };
}
```

- [ ] **Step 6: Fix the same fallout in auth.service.spec.ts**

Same change in `apps/server/src/modules/auth/__tests__/auth.service.spec.ts` — its `membershipFor` (line 32-39) is a separate, identically-shaped copy:

```ts
function membershipFor(
  userId: string,
  businessId: string,
  roleId: string,
  now: Date = new Date(),
  themeColor = "steel",
): UserWithRole["userBusinesses"][number] {
  return { id: randomUUID(), userId, businessId, roleId, role: roleFor(roleId, now), themeColor, createdAt: now };
}
```

- [ ] **Step 7: Verify everything still typechecks and passes**

```bash
pnpm --filter @bmp/database generate
pnpm --filter @bmp/server typecheck
pnpm --filter @bmp/server test -- users/__tests__/users.service.spec.ts auth/__tests__/auth.service.spec.ts
```

Expected: typecheck exits 0, both test files pass with no changes to assertions (only fixture shape changed).

- [ ] **Step 8: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/types/src/theme.ts packages/types/src/index.ts apps/server/src/modules/users/__tests__/users.service.spec.ts apps/server/src/modules/auth/__tests__/auth.service.spec.ts
git commit -m "feat(database): add themeColor column to UserBusiness"
```

---

### Task 2: Backend DTOs

**Files:**
- Modify: `packages/types/src/auth.ts`
- Modify: `packages/types/src/user.ts`

**Interfaces:**
- Consumes: `ThemeColorKey` from `@bmp/types` (Task 1).
- Produces: `AvailableBusiness.themeColor: ThemeColorKey`, used by Task 3 (backend mapping) and Task 7/9 (frontend store/sync).
- Produces: `UpdateThemeColorInput { businessId: string; themeColor: ThemeColorKey }`, used by Task 4 (validation) and Task 8 (frontend hook).

- [ ] **Step 1: Extend `AvailableBusiness`**

In `packages/types/src/auth.ts`, change:

```ts
export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
}
```

to:

```ts
import type { ThemeColorKey } from "./theme.js";

export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
  themeColor: ThemeColorKey;
}
```

(Add the `import type` line at the top of the file, alongside the existing `import type { UserDto } from "./user.js";`.)

- [ ] **Step 2: Add `UpdateThemeColorInput`**

In `packages/types/src/user.ts`, add this import at the top:

```ts
import type { ThemeColorKey } from "./theme.js";
```

and this interface after `UpdateOwnProfileInput`:

```ts
export interface UpdateThemeColorInput {
  businessId: string;
  themeColor: ThemeColorKey;
}
```

- [ ] **Step 3: Verify it typechecks**

```bash
pnpm --filter @bmp/types typecheck
```

Expected: exits 0. (No test file for this package — it's pure type declarations.)

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/auth.ts packages/types/src/user.ts
git commit -m "feat(types): add themeColor to AvailableBusiness and UpdateThemeColorInput"
```

---

### Task 3: Repository layer — read and write `themeColor`

**Files:**
- Modify: `apps/server/src/modules/businesses/businesses.repository.ts`
- Modify: `apps/server/src/modules/users/users.repository.ts`

**Interfaces:**
- Consumes: `Prisma.UserBusiness.themeColor` column (Task 1).
- Produces: `IBusinessesRepository.listUserBusinesses(...)` items now include `themeColor: string`, consumed by `auth.service.ts`'s existing `resolveActiveBusiness` (no code change needed there — it just spreads whatever `listUserBusinesses` returns into `availableBusinesses`).
- Produces: `IUsersRepository.updateThemeColor(id: string, businessId: string, themeColor: string): Promise<UserWithRole>`, consumed by Task 4 (`UsersService.updateThemeColor`).

- [ ] **Step 1: Include `themeColor` in `listUserBusinesses`**

In `apps/server/src/modules/businesses/businesses.repository.ts`, change the interface method signature from:

```ts
  listUserBusinesses(
    userId: string,
  ): Promise<Array<{ businessId: string; businessName: string; businessCode: string }>>;
```

to:

```ts
  listUserBusinesses(
    userId: string,
  ): Promise<
    Array<{ businessId: string; businessName: string; businessCode: string; themeColor: string }>
  >;
```

and the implementation from:

```ts
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
```

to:

```ts
  async listUserBusinesses(
    userId: string,
  ): Promise<
    Array<{ businessId: string; businessName: string; businessCode: string; themeColor: string }>
  > {
    const rows = await this.prisma.userBusiness.findMany({
      where: { userId },
      include: { business: true },
    });
    return rows.map((row) => ({
      businessId: row.businessId,
      businessName: row.business.name,
      businessCode: row.business.code,
      themeColor: row.themeColor,
    }));
  }
```

- [ ] **Step 2: Add `updateThemeColor` to `IUsersRepository`**

In `apps/server/src/modules/users/users.repository.ts`, add to the `IUsersRepository` interface (after `assignRole`):

```ts
  updateThemeColor(id: string, businessId: string, themeColor: string): Promise<UserWithRole>;
```

- [ ] **Step 3: Implement it**

Add to the `UsersRepository` class, after `assignRole` — mirrors that method's shape exactly (both write to the `UserBusiness` row via its compound unique key, then re-fetch scoped to `businessId`):

```ts
  async updateThemeColor(id: string, businessId: string, themeColor: string): Promise<UserWithRole> {
    await this.prisma.userBusiness.update({
      where: { userId_businessId: { userId: id, businessId } },
      data: { themeColor },
    });
    return this.findById(id, businessId) as Promise<UserWithRole>;
  }
```

- [ ] **Step 4: Verify it typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/businesses/businesses.repository.ts apps/server/src/modules/users/users.repository.ts
git commit -m "feat(server): read/write themeColor at the repository layer"
```

---

### Task 4: Service, validation, controller, route

**Files:**
- Modify: `apps/server/src/modules/users/users.validation.ts`
- Modify: `apps/server/src/modules/users/users.service.ts`
- Modify: `apps/server/src/modules/users/users.controller.ts`
- Modify: `apps/server/src/modules/users/users.routes.ts`

**Interfaces:**
- Consumes: `IUsersRepository.updateThemeColor` (Task 3), `THEME_COLOR_KEYS` (Task 1).
- Produces: `UsersService.updateThemeColor(userId: string, businessId: string, themeColor: string): Promise<UserDto>`, consumed by Task 5's tests and the controller in this task.
- Produces: `PATCH /users/me/theme-color` HTTP route, consumed by Task 8 (frontend hook) and Task 5's integration test.

- [ ] **Step 1: Add the validation schema**

In `apps/server/src/modules/users/users.validation.ts`, add the import:

```ts
import { THEME_COLOR_KEYS } from "@bmp/types";
```

and, after `updateOwnProfileSchema`:

```ts
export const updateThemeColorSchema = z.object({
  businessId: z.string().uuid(),
  themeColor: z.enum(THEME_COLOR_KEYS),
});
export type UpdateThemeColorBody = z.infer<typeof updateThemeColorSchema>;
```

- [ ] **Step 2: Add the service method**

In `apps/server/src/modules/users/users.service.ts`, add after `updateOwnProfile`:

```ts
  async updateThemeColor(userId: string, businessId: string, themeColor: string): Promise<UserDto> {
    this.assertMember(await this.usersRepository.findById(userId, businessId));

    const user = await this.usersRepository.updateThemeColor(userId, businessId, themeColor);
    await this.auditService.log({
      actorId: userId,
      action: "USER_THEME_COLOR_UPDATED",
      entityType: "User",
      entityId: userId,
      metadata: { businessId, themeColor },
    });
    return this.toDto(user);
  }
```

This reuses the existing `assertMember` helper (already defined in this file) to turn "no membership row for this `businessId`" into a `NotFoundError` — the same check every other business-scoped method in this service already performs, so a user can't set a color for a business they don't belong to.

- [ ] **Step 3: Add the controller handler**

In `apps/server/src/modules/users/users.controller.ts`, add the import:

```ts
import type {
  AssignRoleBody,
  CreateUserBody,
  ListUsersQuery,
  UpdateOwnProfileBody,
  UpdateThemeColorBody,
  UpdateUserBody,
} from "./users.validation.js";
```

(replacing the existing narrower import list), and add this handler after `updateMe`:

```ts
  updateThemeColor = asyncHandler(async (req, res) => {
    const body = req.body as UpdateThemeColorBody;
    const user = await this.usersService.updateThemeColor(req.user!.id, body.businessId, body.themeColor);
    sendSuccess(res, user, "Theme color updated");
  });
```

- [ ] **Step 4: Wire the route**

In `apps/server/src/modules/users/users.routes.ts`, add `updateThemeColorSchema` to the existing validation import:

```ts
import {
  assignRoleSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateOwnProfileSchema,
  updateThemeColorSchema,
  updateUserSchema,
} from "./users.validation.js";
```

and add this route immediately after the `/me` block (before `/me/avatar`):

```ts
  /**
   * @openapi
   * /users/me/theme-color:
   *   patch:
   *     tags: [Users]
   *     summary: Set the current user's accent color for one of their businesses
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated profile }
   */
  router.patch(
    "/me/theme-color",
    authenticateMiddleware,
    validate(updateThemeColorSchema),
    controller.updateThemeColor,
  );
```

- [ ] **Step 5: Verify it typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/users/users.validation.ts apps/server/src/modules/users/users.service.ts apps/server/src/modules/users/users.controller.ts apps/server/src/modules/users/users.routes.ts
git commit -m "feat(server): add PATCH /users/me/theme-color endpoint"
```

---

### Task 5: Backend tests

**Files:**
- Modify: `apps/server/src/modules/users/__tests__/users.service.spec.ts`
- Create: `apps/server/src/modules/users/__tests__/users.integration.spec.ts`

**Interfaces:**
- Consumes: `UsersService.updateThemeColor` (Task 4), `FakeUsersRepository` (existing fixture in this file, extended here).

- [ ] **Step 1: Write the failing unit test**

In `apps/server/src/modules/users/__tests__/users.service.spec.ts`, add `updateThemeColor` to the `FakeUsersRepository` class (after its `assignRole` method):

```ts
  async updateThemeColor(id: string, businessId: string, themeColor: string) {
    const user = this.users.get(id);
    if (!user) throw new Error("not found");
    const membership = user.userBusinesses.find((ub) => ub.businessId === businessId);
    if (membership) membership.themeColor = themeColor;
    return this.scopedTo(user, businessId);
  }
```

Then add this test block at the end of the `describe("UsersService", ...)` block (find the closing pattern of the last existing `describe`/`it` and add a sibling `describe`):

```ts
  describe("updateThemeColor", () => {
    it("updates the themeColor on the caller's membership for that business", async () => {
      const userId = randomUUID();
      usersRepository.users.set(
        userId,
        buildUser({ id: userId, businessId: BUSINESS_ID, roleId: "role-viewer" }),
      );

      const result = await usersService.updateThemeColor(userId, BUSINESS_ID, "violet");

      expect(result.id).toBe(userId);
      const stored = usersRepository.users.get(userId)!;
      expect(stored.userBusinesses.find((ub) => ub.businessId === BUSINESS_ID)?.themeColor).toBe(
        "violet",
      );
    });

    it("throws NotFoundError when the caller has no membership in that business", async () => {
      const userId = randomUUID();
      usersRepository.users.set(
        userId,
        buildUser({ id: userId, businessId: BUSINESS_ID, roleId: "role-viewer" }),
      );

      await expect(
        usersService.updateThemeColor(userId, OTHER_BUSINESS_ID, "violet"),
      ).rejects.toThrow(NotFoundError);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails first (sanity check the test actually exercises new code)**

```bash
pnpm --filter @bmp/server test -- users/__tests__/users.service.spec.ts
```

Expected: FAIL — `usersService.updateThemeColor is not a function` (Task 4 already implemented it in this plan's sequence, so if you're executing tasks in order this should already PASS; if you're verifying Task 4 and 5 independently, temporarily comment out the service method to confirm the test catches its absence, then restore it).

- [ ] **Step 3: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- users/__tests__/users.service.spec.ts
```

Expected: PASS, both new tests green alongside all existing ones in the file.

- [ ] **Step 4: Write the integration test**

Create `apps/server/src/modules/users/__tests__/users.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  createIntegrationTestUser,
  cleanupIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, with migrations applied
 * (`pnpm db:migrate` against the test database). Run via `pnpm --filter @bmp/server test`
 * after `docker compose up`.
 */
describe("PATCH /users/me/theme-color (integration)", () => {
  const app: Express = createApp();
  let testUser: IntegrationTestUser;

  beforeEach(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterEach(async () => {
    await cleanupIntegrationTestUser(testUser);
  });

  it("updates the theme color for a business the user belongs to", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/theme-color")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ businessId: testUser.businessId, themeColor: "teal" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const membership = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: testUser.userId, businessId: testUser.businessId } },
    });
    expect(membership?.themeColor).toBe("teal");
  });

  it("rejects an unknown themeColor value with 400", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/theme-color")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ businessId: testUser.businessId, themeColor: "not-a-real-color" });

    expect(response.status).toBe(400);
  });

  it("rejects a businessId the user has no membership in with 404", async () => {
    const foreignBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Foreign Business", code: `FB-${randomUUID().slice(0, 8)}` },
    });

    const response = await request(app)
      .patch("/api/v1/users/me/theme-color")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ businessId: foreignBusiness.id, themeColor: "teal" });

    expect(response.status).toBe(404);

    await prisma.business.deleteMany({ where: { id: foreignBusiness.id } });
  });
});
```

- [ ] **Step 5: Run the integration test**

Requires `docker compose up -d postgres redis minio minio-init mailhog` running and `.env.test` migrated (`dotenv -e .env.test -- pnpm --filter @bmp/database migrate:dev` if not already applied). Then:

```bash
pnpm --filter @bmp/server test -- users/__tests__/users.integration.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/users/__tests__/users.service.spec.ts apps/server/src/modules/users/__tests__/users.integration.spec.ts
git commit -m "test(server): cover PATCH /users/me/theme-color"
```

---

### Task 6: Frontend palette + apply/cache helpers

**Files:**
- Create: `apps/web/src/lib/theme-colors.ts`
- Create: `apps/web/src/lib/theme-colors.spec.ts`

**Interfaces:**
- Consumes: `ThemeColorKey`, `THEME_COLOR_KEYS` from `@bmp/types` (Task 1).
- Produces: `THEME_COLORS: Record<ThemeColorKey, {light: ThemeColorVars; dark: ThemeColorVars}>`, `getThemeColorVars(key, mode)`, `applyThemeColorVars(key, mode)`, `readCachedThemeColorVars()` — all consumed by Task 9 (sync effect + inline script) and Task 10 (picker component, for rendering swatch preview colors).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/theme-colors.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { getThemeColorVars, THEME_COLORS } from "./theme-colors";

describe("getThemeColorVars", () => {
  it("returns the light variant for a known key", () => {
    expect(getThemeColorVars("blue", "light")).toEqual(THEME_COLORS.blue.light);
  });

  it("returns the dark variant for a known key", () => {
    expect(getThemeColorVars("blue", "dark")).toEqual(THEME_COLORS.blue.dark);
  });

  it("falls back to steel for an unknown key", () => {
    expect(getThemeColorVars("not-a-real-key" as never, "light")).toEqual(THEME_COLORS.steel.light);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @bmp/web test -- src/lib/theme-colors.spec.ts
```

Expected: FAIL — `Cannot find module './theme-colors'`.

- [ ] **Step 3: Write the palette and helpers**

Create `apps/web/src/lib/theme-colors.ts`:

```ts
import { THEME_COLOR_KEYS, type ThemeColorKey } from "@bmp/types";

export interface ThemeColorVars {
  primary: string;
  primaryForeground: string;
  ring: string;
}

const LIGHT_FOREGROUND = "210 40% 98%";
const DARK_FOREGROUND = "222 47% 11%";

export const THEME_COLORS: Record<ThemeColorKey, { light: ThemeColorVars; dark: ThemeColorVars }> = {
  steel: {
    light: { primary: "216 65% 34%", primaryForeground: LIGHT_FOREGROUND, ring: "216 65% 34%" },
    dark: { primary: "216 65% 58%", primaryForeground: DARK_FOREGROUND, ring: "216 65% 58%" },
  },
  blue: {
    light: { primary: "221 70% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "221 70% 45%" },
    dark: { primary: "217 75% 60%", primaryForeground: DARK_FOREGROUND, ring: "217 75% 60%" },
  },
  green: {
    light: { primary: "152 55% 32%", primaryForeground: LIGHT_FOREGROUND, ring: "152 55% 32%" },
    dark: { primary: "150 55% 45%", primaryForeground: DARK_FOREGROUND, ring: "150 55% 45%" },
  },
  violet: {
    light: { primary: "262 55% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "262 55% 45%" },
    dark: { primary: "258 60% 62%", primaryForeground: DARK_FOREGROUND, ring: "258 60% 62%" },
  },
  amber: {
    light: { primary: "38 80% 38%", primaryForeground: LIGHT_FOREGROUND, ring: "38 80% 38%" },
    dark: { primary: "38 85% 55%", primaryForeground: DARK_FOREGROUND, ring: "38 85% 55%" },
  },
  rose: {
    light: { primary: "347 65% 42%", primaryForeground: LIGHT_FOREGROUND, ring: "347 65% 42%" },
    dark: { primary: "347 70% 60%", primaryForeground: DARK_FOREGROUND, ring: "347 70% 60%" },
  },
  teal: {
    light: { primary: "175 60% 30%", primaryForeground: LIGHT_FOREGROUND, ring: "175 60% 30%" },
    dark: { primary: "175 55% 45%", primaryForeground: DARK_FOREGROUND, ring: "175 55% 45%" },
  },
  slate: {
    light: { primary: "215 20% 35%", primaryForeground: LIGHT_FOREGROUND, ring: "215 20% 35%" },
    dark: { primary: "215 15% 60%", primaryForeground: DARK_FOREGROUND, ring: "215 15% 60%" },
  },
  indigo: {
    light: { primary: "243 60% 48%", primaryForeground: LIGHT_FOREGROUND, ring: "243 60% 48%" },
    dark: { primary: "240 65% 65%", primaryForeground: DARK_FOREGROUND, ring: "240 65% 65%" },
  },
  orange: {
    light: { primary: "22 80% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "22 80% 45%" },
    dark: { primary: "24 85% 58%", primaryForeground: DARK_FOREGROUND, ring: "24 85% 58%" },
  },
};

export function getThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): ThemeColorVars {
  const entry = THEME_COLORS[key] ?? THEME_COLORS.steel;
  return entry[mode];
}

const CACHE_KEY = "bmp-theme-color-vars";

export function applyThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): void {
  const vars = getThemeColorVars(key, mode);
  const root = document.documentElement.style;
  root.setProperty("--primary", vars.primary);
  root.setProperty("--primary-foreground", vars.primaryForeground);
  root.setProperty("--ring", vars.ring);
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(vars));
}

export function readCachedThemeColorVars(): ThemeColorVars | null {
  const raw = window.localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThemeColorVars;
  } catch {
    return null;
  }
}

export { THEME_COLOR_KEYS };
export type { ThemeColorKey };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @bmp/web test -- src/lib/theme-colors.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme-colors.ts apps/web/src/lib/theme-colors.spec.ts
git commit -m "feat(web): add theme color palette and apply/cache helpers"
```

---

### Task 7: Auth store action

**Files:**
- Modify: `apps/web/src/lib/auth-store.ts`

**Interfaces:**
- Produces: `useAuthStore`'s `updateBusinessThemeColor(businessId: string, themeColor: string): void`, consumed by Task 8 (`useUpdateThemeColor` hook).

- [ ] **Step 1: Add the action**

In `apps/web/src/lib/auth-store.ts`, add `ThemeColorKey` to the existing `@bmp/types` import:

```ts
import type { ThemeColorKey, UserDto } from "@bmp/types";
```

Add to the `AuthState` interface (after `setUser`):

```ts
  updateBusinessThemeColor: (businessId: string, themeColor: ThemeColorKey) => void;
```

and to the store implementation (after `setUser: (user) => set({ user }),`):

```ts
  updateBusinessThemeColor: (businessId, themeColor) =>
    set((state) => ({
      availableBusinesses: state.availableBusinesses.map((b) =>
        b.businessId === businessId ? { ...b, themeColor } : b,
      ),
    })),
```

This is fully typed end to end: Task 8's hook calls it with `input.themeColor`, which is already `ThemeColorKey` (from `UpdateThemeColorInput`), so no cast is needed anywhere.

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0. (No existing test file for `auth-store.ts` — it's a thin Zustand store with no branching logic beyond object spreads, consistent with this codebase's practice of not unit-testing simple stores directly; it's exercised indirectly via Task 8's hook.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/auth-store.ts
git commit -m "feat(web): add updateBusinessThemeColor action to auth store"
```

---

### Task 8: Frontend mutation hook

**Files:**
- Modify: `apps/web/src/hooks/use-users.ts`

**Interfaces:**
- Consumes: `PATCH /users/me/theme-color` (Task 4), `useAuthStore.updateBusinessThemeColor` (Task 7), `UpdateThemeColorInput` (Task 2).
- Produces: `useUpdateThemeColor()` hook returning a TanStack `useMutation` result, consumed by Task 10 (picker component).

- [ ] **Step 1: Add the hook**

In `apps/web/src/hooks/use-users.ts`, add `UpdateThemeColorInput` to the existing `@bmp/types` import:

```ts
import type {
  ApiResponse,
  AssignRoleInput,
  CreateUserInput,
  ListUsersQuery,
  PaginatedResult,
  UpdateOwnProfileInput,
  UpdateThemeColorInput,
  UpdateUserInput,
  UserDto,
} from "@bmp/types";
```

and add this hook after `useUploadAvatar`:

```ts
export function useUpdateThemeColor() {
  const updateBusinessThemeColor = useAuthStore((state) => state.updateBusinessThemeColor);
  return useMutation({
    mutationFn: async (input: UpdateThemeColorInput) => {
      const response = await apiClient.patch<ApiResponse<UserDto>>("/users/me/theme-color", input);
      return unwrap(response.data);
    },
    onSuccess: (_user, input) => {
      updateBusinessThemeColor(input.businessId, input.themeColor);
    },
  });
}
```

Note this patches the store from the *input* the mutation was called with, not from the server response — the endpoint's 200 response is proof the write succeeded, and the caller already knows exactly which `businessId`/`themeColor` it asked for, so there's nothing extra to read off the response body for this purpose.

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-users.ts
git commit -m "feat(web): add useUpdateThemeColor hook"
```

---

### Task 9: Apply the color — sync effect + pre-hydration script

**Files:**
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `useAuthStore` (`activeBusinessId`, `availableBusinesses`), `useTheme` (from `next-themes`), `applyThemeColorVars`/`readCachedThemeColorVars` (Task 6).

- [ ] **Step 1: Add the sync effect to the dashboard layout**

In `apps/web/src/app/(dashboard)/layout.tsx`, add these imports:

```ts
import { useTheme } from "next-themes";

import { applyThemeColorVars } from "@/lib/theme-colors";
```

and, inside `DashboardLayout`, add this alongside the existing `useEffect` (hooks must run unconditionally on every render, so place it before the `if (isInitializing)` early return):

```ts
  const activeBusinessId = useAuthStore((state) => state.activeBusinessId);
  const availableBusinesses = useAuthStore((state) => state.availableBusinesses);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const active = availableBusinesses.find((b) => b.businessId === activeBusinessId);
    if (!active) return;
    applyThemeColorVars(active.themeColor, resolvedTheme === "dark" ? "dark" : "light");
  }, [activeBusinessId, availableBusinesses, resolvedTheme]);
```

This re-applies whenever the active business changes (login, switch-business), whenever `availableBusinesses` changes (e.g. after `useUpdateThemeColor`'s store patch from Task 8), and whenever light/dark mode toggles.

- [ ] **Step 2: Add the pre-hydration script to the root layout**

In `apps/web/src/app/layout.tsx`, add this immediately after the opening `<html ...>` tag, before `<body>`:

```tsx
      <head>
        <script
          // Mirrors next-themes' own inline-script approach: read the last-applied
          // color synchronously and paint it before hydration, avoiding a flash of
          // the default color. The DashboardLayout effect reconciles it against the
          // server-derived value once the auth store hydrates (e.g. if this cache
          // is stale because the color was changed on another device).
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=JSON.parse(localStorage.getItem("bmp-theme-color-vars"));if(!v)return;var s=document.documentElement.style;s.setProperty("--primary",v.primary);s.setProperty("--primary-foreground",v.primaryForeground);s.setProperty("--ring",v.ring);}catch(e){}})();`,
          }}
        />
      </head>
```

The full function becomes:

```tsx
export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=JSON.parse(localStorage.getItem("bmp-theme-color-vars"));if(!v)return;var s=document.documentElement.style;s.setProperty("--primary",v.primary);s.setProperty("--primary-foreground",v.primaryForeground);s.setProperty("--ring",v.ring);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Manually verify in the browser**

Stop and restart the dev server if it's running (Next.js needs a fresh compile for the layout change):

```bash
pnpm --filter @bmp/web dev
```

Log in, go to `/profile` (picker isn't wired yet — that's Task 10 — so for now just confirm nothing broke): the app should look identical to before (still `steel`, since that's the DB default). Open browser dev tools → Application → Local Storage — after the dashboard mounts, confirm a `bmp-theme-color-vars` key now exists with `{"primary":"216 65% 34%",...}`. Toggle dark mode via the existing `ThemeToggle` in the topbar and confirm the cached value updates to the dark-mode HSL triplet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/layout.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): apply active business's theme color, with pre-hydration cache"
```

---

### Task 10: Theme color picker UI

**Files:**
- Create: `apps/web/src/components/profile/theme-color-picker.tsx`
- Modify: `apps/web/src/app/(dashboard)/profile/page.tsx`

**Interfaces:**
- Consumes: `useUpdateThemeColor` (Task 8), `THEME_COLORS`/`THEME_COLOR_KEYS` (Task 6), `useAuthStore.availableBusinesses` (Task 7).

- [ ] **Step 1: Build the picker component**

Create `apps/web/src/components/profile/theme-color-picker.tsx`:

```tsx
"use client";

import { Button, useToast } from "@bmp/ui";
import type { ThemeColorKey } from "@bmp/types";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";

import { useUpdateThemeColor } from "@/hooks/use-users";
import { THEME_COLOR_KEYS, THEME_COLORS } from "@/lib/theme-colors";

interface ThemeColorPickerProps {
  businessId: string;
  businessName: string;
  activeColor: ThemeColorKey;
}

export function ThemeColorPicker({ businessId, businessName, activeColor }: ThemeColorPickerProps) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const updateThemeColor = useUpdateThemeColor();
  const mode = resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{businessName}</p>
      <div className="flex flex-wrap gap-2">
        {THEME_COLOR_KEYS.map((key) => {
          const vars = THEME_COLORS[key][mode];
          const isActive = key === activeColor;
          return (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="icon"
              aria-label={key}
              aria-pressed={isActive}
              disabled={updateThemeColor.isPending}
              className="h-8 w-8 rounded-full border-2 p-0"
              style={{
                backgroundColor: `hsl(${vars.primary})`,
                borderColor: isActive ? `hsl(${vars.primary})` : "transparent",
              }}
              onClick={async () => {
                try {
                  await updateThemeColor.mutateAsync({ businessId, themeColor: key });
                } catch (error) {
                  toast({
                    variant: "destructive",
                    title: "Could not update theme color",
                    description: error instanceof Error ? error.message : "Please try again.",
                  });
                }
              }}
            >
              {isActive && <Check className="h-4 w-4" style={{ color: `hsl(${vars.primaryForeground})` }} />}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the profile page**

In `apps/web/src/app/(dashboard)/profile/page.tsx`, add these imports:

```ts
import { ThemeColorPicker } from "@/components/profile/theme-color-picker";
```

(add `CardDescription` to the existing `@bmp/ui` import if not already there — it already is, per the "Change password" card).

Add `const availableBusinesses = useAuthStore((state) => state.availableBusinesses);` alongside the existing `const user = useAuthStore((state) => state.user);` line.

Add this new `Card` between the "Personal information" card and the "Change password" card:

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Theme color</CardTitle>
          <CardDescription>
            Pick an accent color for each business you belong to — helps tell them apart at a glance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {availableBusinesses.map((business) => (
            <ThemeColorPicker
              key={business.businessId}
              businessId={business.businessId}
              businessName={business.businessName}
              activeColor={business.themeColor}
            />
          ))}
        </CardContent>
      </Card>
```

- [ ] **Step 3: Manually verify in the browser**

```bash
pnpm --filter @bmp/web dev
```

Log in (any seeded user, e.g. `admin@bmp.local` / `ChangeMe123!`), go to `/profile`. Confirm:
- A "Theme color" card renders with one swatch-grid row per business the user belongs to.
- Clicking a swatch updates `--primary`/`--ring` across the whole app immediately (e.g. primary buttons, the active nav item, focus rings) — no page reload.
- Reloading the page keeps the picked color (persisted via the DB, reconciled through `AuthProvider`'s silent refresh → `availableBusinesses`).
- If the user has more than one business (seed data may only have one per user — check `packages/database/prisma/seed.ts` or create a second membership manually via the "Businesses" admin screen if available), switching business via the topbar switcher changes the accent color to that business's own pick.
- Toggling light/dark mode keeps the chosen accent hue, using that mode's variant.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/profile/theme-color-picker.tsx apps/web/src/app/\(dashboard\)/profile/page.tsx
git commit -m "feat(web): add theme color picker to the profile page"
```

---

## Self-Review Notes

- **Spec coverage:** palette/curated-swatches (Task 6), per-`(user,business)` storage (Task 1), read path via existing `availableBusinesses` (Tasks 2-3), self-scoped write endpoint (Task 4), profile-page UI showing all memberships (Task 10), flash-of-wrong-color prevention (Task 9) — all covered. The spec's suggested per-`businessId`-keyed `localStorage` cache was simplified to a single flat cache key (Task 6/9): the pre-hydration script only needs to avoid a paint flash for whatever was last on screen, and the `DashboardLayout` effect reconciles against server truth immediately after hydration regardless — a per-business cache adds no correctness benefit here, only complexity.
- **Type consistency:** `ThemeColorKey` (Task 1) flows unchanged through `AvailableBusiness.themeColor`, `UpdateThemeColorInput.themeColor`, `updateThemeColorSchema`'s `z.enum(THEME_COLOR_KEYS)`, and `THEME_COLORS`'s `Record<ThemeColorKey, ...>` — verified no task renames it partway.
- **No placeholders:** every step has complete, runnable code; no "TBD"/"handle errors appropriately" left in.
