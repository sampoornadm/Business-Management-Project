# HSN/SAC Reference Lookup, Scheduled Refresh & Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ungrounded LLM HSN-code guess in BOQ enrichment with a lookup against the
real official CBIC HSN/SAC master list, gate suggestions behind explicit human confirmation, add a
scheduled refresh of that reference data, and add a role-gated Settings page hosting the refresh
controls plus a first batch of today's env-configured tunables.

**Architecture:** A new `reference-data` module owns `HsnCode`/`SacCode`/`ReferenceDataImport`
tables and the import/matching logic (ANN retrieval via the existing pgvector infra + a
closed-vocabulary LLM pick, same shape as this codebase's proven category-matching pattern). A new
`settings` module owns a generic `Setting` key-value table gated by two new RBAC keys. A new BullMQ
queue runs the scheduled refresh; manual refresh/upload stay synchronous admin actions.

**Tech Stack:** Express + Prisma + PostgreSQL/pgvector + BullMQ + `exceljs` (already a dependency)
+ Ollama (`bge-m3` embed, `qwen3:4b` classify) — no new packages.

**Spec:** `docs/superpowers/specs/2026-09-24-hsn-sac-reference-and-settings-design.md`

## Global Constraints

- ANN retrieval and matching target `HsnCode` rows where `codeLength = 4` only — the full
  2/6/8-digit hierarchy is stored but not matched against yet (spec's explicit scope boundary).
- The real billing `hsnCode` field is never written from a fresh (non-catalog) suggestion — only
  `suggestedHsnCode`. Only a prior human-confirmed catalog match (`findConfirmedHsn`) may populate
  `hsnCode` automatically, exactly as before.
- `gstRatePercent` matching is unchanged (LLM guess snapped to GST slabs) — this plan does not
  touch GST-rate correctness, only `hsnCode`.
- `SETTING_KEYS` is a closed, explicit union (18 keys) — no code accepts an arbitrary string as a
  settings key. Secrets (`DATABASE_URL`, `REDIS_URL`, `ACCESS_TOKEN_SECRET`, `SMTP_*`, ports,
  `SEED_USER_PASSWORD`) are never included in it.
- `settings:read`/`settings:manage` are SUPER_ADMIN-only (via the existing wildcard permission) —
  `ALL_STANDARD_PERMISSIONS` must explicitly exclude the `settings:` prefix, matching this repo's
  existing `businesses:` exclusion and the `ROLE_DESCRIPTIONS.ADMIN` text ("cannot modify system
  settings"). Do not add these keys to any role's explicit permission array.
- Reuse `exceljs` (already in `apps/server/package.json`) for xlsx parsing and `bullmq` (already a
  dependency) for scheduling — no new packages.
- Follow this repo's existing module layering exactly: `*.repository.ts` (thin Prisma wrapper) /
  `*.service.ts` (business logic, constructor-injected repos) / `*.controller.ts` (thin,
  `asyncHandler` + `sendSuccess`) / `*.routes.ts` (`authenticateMiddleware` +
  `requirePermission` + `validate`) / `*.validation.ts` (Zod) / `*.module.ts` (composition root).
- New permission keys require `pnpm db:seed` on every environment after merge (existing documented
  gotcha — the seed script is idempotent but does not run itself).
- pgvector migrations must never run via plain interactive `prisma migrate dev` (existing gotcha:
  it offers a corrective migration that can drop the existing HNSW indexes). Use
  `migrate dev --create-only` + hand-written SQL + `migrate deploy`, or hand-write the migration
  directly, exactly as this session's earlier BOQ-status-removal migration did.

## Review Focus

- A malformed/corrupted xlsx upload, or one missing the `HSN_MSTR` sheet, must fail with a clear
  error and record nothing — not silently "succeed" with zero rows imported.
- Ollama being unavailable mid-embedding-pass must not roll back the already-upserted reference
  table rows or the `ReferenceDataImport` record — only the embedding step should fail, leaving
  rows for the next pass to pick up (same "one bad step doesn't abandon the rest" rule
  `enrichBoq` already follows).
- A BOQ item with no good HSN analog among its top-8 ANN candidates must yield `null` (no
  suggestion shown), never force-pick the least-bad of 8 irrelevant candidates.
- Re-running an import with unchanged source data must not re-embed already-embedded rows (cost
  control — embedding calls are not free) and must not error on the second upsert.
- A settings value of the wrong type (e.g. a string where `AI_MATCH_THRESHOLD` expects a number)
  must be rejected with a 400, not silently coerced or stored malformed.

---

### Task 1: Schema — HSN/SAC reference tables and the Setting table

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260924144028_add_hsn_sac_and_settings/migration.sql`

**Interfaces:**
- Produces: `HsnCode` (`code`, `description`, `codeLength`, `embedding: Float[]`, `embeddedAt`,
  `embeddingVector`), `SacCode` (same shape), `ReferenceDataImport` (`dataset`, `sourceUrl`,
  `sourceEtag`, `hsnRowCount`, `sacRowCount`, `triggeredById`, `importedAt`), `Setting` (`key`,
  `value`, `updatedById`, `updatedAt`) — every later task reads/writes these via Prisma.

- [ ] **Step 1: Add the four models to `schema.prisma`**

Find the `SavedView` model (end of the "General" section, just before the BOQ & Estimation
section comment) and insert after it:

```prisma
model HsnCode {
  id              String    @id @default(uuid())
  code            String    @unique
  description     String
  codeLength      Int
  embedding       Float[]
  embeddedAt      DateTime?
  embeddingVector Unsupported("vector(1024)")?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([codeLength])
  @@map("hsn_codes")
}

model SacCode {
  id              String    @id @default(uuid())
  code            String    @unique
  description     String
  codeLength      Int
  embedding       Float[]
  embeddedAt      DateTime?
  embeddingVector Unsupported("vector(1024)")?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([codeLength])
  @@map("sac_codes")
}

model ReferenceDataImport {
  id            String   @id @default(uuid())
  dataset       String
  sourceUrl     String
  sourceEtag    String?
  hsnRowCount   Int
  sacRowCount   Int
  triggeredById String?
  triggeredBy   User?    @relation("ReferenceDataImportTriggeredBy", fields: [triggeredById], references: [id], onDelete: SetNull)
  importedAt    DateTime @default(now())

  @@index([dataset, importedAt])
  @@map("reference_data_imports")
}

model Setting {
  key         String   @id
  value       String
  updatedById String?
  updatedBy   User?    @relation("SettingUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)
  updatedAt   DateTime @updatedAt

  @@map("settings")
}
```

- [ ] **Step 2: Add the two reverse relations to the `User` model**

Find `model User {` in `schema.prisma`. Add these two lines alongside its other relation arrays
(e.g. near `boqsCreated Boq[] @relation("BoqCreatedBy")` if present, otherwise anywhere in the
relation-array block):

```prisma
  referenceDataImports ReferenceDataImport[] @relation("ReferenceDataImportTriggeredBy")
  settingsUpdated      Setting[]             @relation("SettingUpdatedBy")
```

- [ ] **Step 3: Validate the schema**

Run: `pnpm --filter @bmp/database exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Hand-write the migration SQL**

Create `packages/database/prisma/migrations/20260924144028_add_hsn_sac_and_settings/migration.sql`
(the directory name's timestamp must be later than every existing migration's — confirm with
`ls packages/database/prisma/migrations | tail -3` before writing; adjust the timestamp prefix if
a newer migration now exists):

```sql
CREATE TABLE "hsn_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddedAt" TIMESTAMP(3),
    "embeddingVector" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hsn_codes_code_key" ON "hsn_codes"("code");
CREATE INDEX "hsn_codes_codeLength_idx" ON "hsn_codes"("codeLength");
CREATE INDEX "hsn_codes_embeddingVector_hnsw_idx" ON "hsn_codes"
  USING hnsw ("embeddingVector" vector_cosine_ops);

CREATE TABLE "sac_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddedAt" TIMESTAMP(3),
    "embeddingVector" vector(1024),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sac_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sac_codes_code_key" ON "sac_codes"("code");
CREATE INDEX "sac_codes_codeLength_idx" ON "sac_codes"("codeLength");

CREATE TABLE "reference_data_imports" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceEtag" TEXT,
    "hsnRowCount" INTEGER NOT NULL,
    "sacRowCount" INTEGER NOT NULL,
    "triggeredById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_data_imports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reference_data_imports_dataset_importedAt_idx" ON "reference_data_imports"("dataset", "importedAt");
ALTER TABLE "reference_data_imports" ADD CONSTRAINT "reference_data_imports_triggeredById_fkey"
  FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "settings" ADD CONSTRAINT "settings_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Apply the migration to the dev and test databases**

Run:
```bash
pnpm exec dotenv -e .env -- pnpm --filter @bmp/database exec prisma migrate deploy
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/database exec prisma migrate deploy
```
Expected: both print `All migrations have been successfully applied.`

- [ ] **Step 6: Regenerate the Prisma client**

Run: `pnpm exec dotenv -e .env -- pnpm --filter @bmp/database generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): add HsnCode/SacCode/ReferenceDataImport/Setting tables"
```

---

### Task 2: `@bmp/types` — reference data and settings DTOs

**Files:**
- Create: `packages/types/src/reference-data.ts`
- Create: `packages/types/src/settings.ts`
- Modify: `packages/types/src/index.ts` (or wherever this package re-exports its modules — check
  with `grep -n "export \*" packages/types/src/index.ts` first)

**Interfaces:**
- Produces: `ReferenceDataImportDto`, `SETTING_KEYS`, `SettingKey`, `SettingValueType`,
  `SettingDto` — consumed by every later server and frontend task. (The HSN suggestion itself
  needs no dedicated DTO — `BoqItemDto.suggestedHsnCode` is already a plain `string | null` field
  in the existing schema; nothing in this plan wraps it in a richer type.)

- [ ] **Step 1: Write `packages/types/src/reference-data.ts`**

```ts
export interface ReferenceDataImportDto {
  id: string;
  dataset: string;
  sourceUrl: string;
  hsnRowCount: number;
  sacRowCount: number;
  triggeredByName: string | null;
  importedAt: string;
}
```

- [ ] **Step 2: Write `packages/types/src/settings.ts`**

```ts
export const SETTING_KEYS = [
  "TENDER_NOTES_AI_ENABLED",
  "AI_ENRICHMENT_ENABLED",
  "OLLAMA_MODEL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_ENRICHMENT_MODEL",
  "OLLAMA_BASE_URL",
  "AI_MATCH_THRESHOLD",
  "AI_CONTEXT_FLOOR",
  "DOCUMENT_MATCH_THRESHOLD",
  "LOCAL_DOCS_SYNC_ENABLED",
  "INCOMING_TENDERS_INGESTION_ENABLED",
  "DOCUMENT_INDEXING_ENABLED",
  "ASSISTANT_TIMEZONE",
  "ACCESS_TOKEN_TTL_MINUTES",
  "REFRESH_TOKEN_TTL_DAYS",
  "PASSWORD_RESET_TOKEN_TTL_MINUTES",
  "EMAIL_VERIFICATION_TOKEN_TTL_HOURS",
  "HSN_SAC_AUTO_REFRESH_ENABLED",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export type SettingValueType = "string" | "number" | "boolean";

export interface SettingDto {
  key: SettingKey;
  type: SettingValueType;
  label: string;
  group: string;
  value: string | number | boolean;
  isOverridden: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}
```

- [ ] **Step 3: Re-export both from the package entrypoint**

Run `grep -n "export \*" "packages/types/src/index.ts"` to see the existing pattern, then add two
lines following it exactly:
```ts
export * from "./reference-data.js";
export * from "./settings.js";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bmp/types exec tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/reference-data.ts packages/types/src/settings.ts packages/types/src/index.ts
git commit -m "feat(types): add reference-data and settings DTOs"
```

---

### Task 3: RBAC — `settings:read` / `settings:manage`

**Files:**
- Modify: `packages/types/src/rbac.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `"settings:read"`, `"settings:manage"` as valid `PermissionKey` values, granted only
  to `SUPER_ADMIN` (via the existing wildcard, not this matrix) — every other role, including
  `ADMIN`, must not have them.

- [ ] **Step 1: Add the two keys to `PERMISSION_KEYS`**

Add near the end of the `PERMISSION_KEYS` array (find it with
`grep -n "PERMISSION_KEYS = \[" packages/types/src/rbac.ts`):
```ts
  "settings:read",
  "settings:manage",
```

- [ ] **Step 2: Exclude the `settings:` prefix from `ALL_STANDARD_PERMISSIONS`**

Find:
```ts
const ALL_STANDARD_PERMISSIONS: PermissionKey[] = PERMISSION_KEYS.filter(
  (key) => !key.startsWith("businesses:"),
);
```
Replace with:
```ts
// SUPER_ADMIN-only, via the wildcard permission — not through this matrix. Mirrors the
// businesses: exclusion above: ADMIN explicitly "cannot modify system settings"
// (see ROLE_DESCRIPTIONS.ADMIN below).
const ALL_STANDARD_PERMISSIONS: PermissionKey[] = PERMISSION_KEYS.filter(
  (key) => !key.startsWith("businesses:") && !key.startsWith("settings:"),
);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bmp/types exec tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Write a unit test confirming the exclusion**

Check whether `packages/types` has an existing `__tests__` directory
(`find packages/types -iname "*.spec.ts"`); if one exists mirroring `rbac.ts` already, extend it —
otherwise create `packages/types/src/__tests__/rbac.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, ROLE_PERMISSION_MATRIX } from "../rbac.js";

describe("settings permissions", () => {
  it("are not granted to ADMIN or any non-SUPER_ADMIN role", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      if (role === "SUPER_ADMIN") continue;
      expect(permissions).not.toContain("settings:read");
      expect(permissions).not.toContain("settings:manage");
    }
  });

  it("exist as valid permission keys", () => {
    expect(PERMISSION_KEYS).toContain("settings:read");
    expect(PERMISSION_KEYS).toContain("settings:manage");
  });
});
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter @bmp/types exec vitest run src/__tests__/rbac.spec.ts`
Expected: `2 passed`.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/rbac.ts packages/types/src/__tests__/rbac.spec.ts
git commit -m "feat(rbac): add SUPER_ADMIN-only settings:read/settings:manage permissions"
```

---

### Task 4: Reference-data repository and the import/embed service

**Files:**
- Create: `apps/server/src/modules/reference-data/reference-data.repository.ts`
- Create: `apps/server/src/modules/reference-data/hsn-sac-import.service.ts`
- Create: `apps/server/src/modules/reference-data/__tests__/hsn-sac-import.service.spec.ts`

**Interfaces:**
- Consumes: `embed(texts: string[], model?: string): Promise<number[][]>` from
  `apps/server/src/infra/llm/ollama.client.ts`; `ServiceUnavailableError` from
  `apps/server/src/core/errors/HttpErrors.js`.
- Produces: `IReferenceDataRepository` (used by Task 6's matching code and Task 7's controller),
  `HsnSacImportService` with `importFromBuffer(buffer, sourceUrl, sourceEtag, triggeredById)` and
  `fetchAndImport(triggeredById)` — used by Task 7 (routes) and Task 8 (worker).

- [ ] **Step 1: Write `reference-data.repository.ts`**

```ts
import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

export interface UpsertCodeInput {
  code: string;
  description: string;
  codeLength: number;
}

export interface HsnCodeRow {
  code: string;
  description: string;
}

export interface HsnCandidate {
  code: string;
  description: string;
  similarity: number;
}

export interface RecordImportInput {
  dataset: string;
  sourceUrl: string;
  sourceEtag: string | null;
  hsnRowCount: number;
  sacRowCount: number;
  triggeredById: string | null;
}

export interface ReferenceDataImportRow {
  id: string;
  dataset: string;
  sourceUrl: string;
  sourceEtag: string | null;
  hsnRowCount: number;
  sacRowCount: number;
  importedAt: Date;
  triggeredBy: { id: string; firstName: string; lastName: string } | null;
}

const importWithTriggeredByArgs = {
  include: { triggeredBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.ReferenceDataImportDefaultArgs;

export interface IReferenceDataRepository {
  upsertHsnCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  upsertSacCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]>;
  setHsnEmbedding(code: string, embedding: number[]): Promise<void>;
  findNearestHsn(queryVector: number[], codeLength: number, limit: number): Promise<HsnCandidate[]>;
  recordImport(data: RecordImportInput): Promise<void>;
  findLatestImport(dataset: string): Promise<ReferenceDataImportRow | null>;
}

export class ReferenceDataRepository implements IReferenceDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertHsnCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }> {
    const existing = await this.prisma.hsnCode.findMany({ select: { code: true, description: true } });
    const existingByCode = new Map(existing.map((e) => [e.code, e.description]));

    const toCreate = rows.filter((r) => !existingByCode.has(r.code));
    const toUpdate = rows.filter(
      (r) => existingByCode.has(r.code) && existingByCode.get(r.code) !== r.description,
    );

    if (toCreate.length > 0) {
      await this.prisma.hsnCode.createMany({ data: toCreate.map((r) => ({ id: randomUUID(), ...r })) });
    }
    for (const row of toUpdate) {
      // A changed description clears embeddedAt so findUnembeddedHsnCodes picks it back up —
      // the stale embeddingVector sits unused until the next embedding pass overwrites it.
      await this.prisma.hsnCode.update({
        where: { code: row.code },
        data: { description: row.description, codeLength: row.codeLength, embeddedAt: null },
      });
    }
    return { created: toCreate.length, updated: toUpdate.length };
  }

  async upsertSacCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }> {
    const existing = await this.prisma.sacCode.findMany({ select: { code: true, description: true } });
    const existingByCode = new Map(existing.map((e) => [e.code, e.description]));

    const toCreate = rows.filter((r) => !existingByCode.has(r.code));
    const toUpdate = rows.filter(
      (r) => existingByCode.has(r.code) && existingByCode.get(r.code) !== r.description,
    );

    if (toCreate.length > 0) {
      await this.prisma.sacCode.createMany({ data: toCreate.map((r) => ({ id: randomUUID(), ...r })) });
    }
    for (const row of toUpdate) {
      await this.prisma.sacCode.update({
        where: { code: row.code },
        data: { description: row.description, codeLength: row.codeLength, embeddedAt: null },
      });
    }
    return { created: toCreate.length, updated: toUpdate.length };
  }

  findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]> {
    return this.prisma.hsnCode.findMany({
      where: { codeLength: 4, embeddedAt: null },
      select: { code: true, description: true },
      take: limit,
    });
  }

  async setHsnEmbedding(code: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$transaction([
      this.prisma.hsnCode.update({ where: { code }, data: { embedding, embeddedAt: new Date() } }),
      this.prisma
        .$executeRaw`UPDATE hsn_codes SET "embeddingVector" = ${vectorLiteral}::vector WHERE code = ${code}`,
    ]);
  }

  findNearestHsn(queryVector: number[], codeLength: number, limit: number): Promise<HsnCandidate[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT code, description,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM hsn_codes
      WHERE "codeLength" = ${codeLength} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }

  async recordImport(data: RecordImportInput): Promise<void> {
    await this.prisma.referenceDataImport.create({
      data: { id: randomUUID(), ...data },
    });
  }

  findLatestImport(dataset: string): Promise<ReferenceDataImportRow | null> {
    return this.prisma.referenceDataImport.findFirst({
      where: { dataset },
      orderBy: { importedAt: "desc" },
      ...importWithTriggeredByArgs,
    });
  }
}
```

- [ ] **Step 2: Write the failing test for `parseHsnSacWorkbook`**

Create `apps/server/src/modules/reference-data/__tests__/hsn-sac-import.service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));

import type { HsnCodeRow, IReferenceDataRepository, UpsertCodeInput } from "../reference-data.repository.js";
import { HsnSacImportService, parseHsnSacWorkbook } from "../hsn-sac-import.service.js";

async function buildFixtureWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hsn = workbook.addWorksheet("HSN_MSTR");
  hsn.addRow(["HSN_CD", "HSN_Description"]);
  hsn.addRow(["73", "ARTICLES OF IRON OR STEEL"]);
  hsn.addRow(["7307", "TUBE OR PIPE FITTINGS, OF IRON OR STEEL"]);
  const sac = workbook.addWorksheet("SAC_MSTR");
  sac.addRow(["SAC_CD", "SAC_Description"]);
  sac.addRow(["9954", "Construction services"]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseHsnSacWorkbook", () => {
  it("parses both sheets, skips the header row, and derives codeLength from code length", async () => {
    const buffer = await buildFixtureWorkbook();
    const parsed = await parseHsnSacWorkbook(buffer);

    expect(parsed.hsnRows).toEqual([
      { code: "73", description: "ARTICLES OF IRON OR STEEL", codeLength: 2 },
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", codeLength: 4 },
    ]);
    expect(parsed.sacRows).toEqual([
      { code: "9954", description: "Construction services", codeLength: 4 },
    ]);
  });
});

class FakeReferenceDataRepository implements Partial<IReferenceDataRepository> {
  hsnRows = new Map<string, UpsertCodeInput>();
  sacRows = new Map<string, UpsertCodeInput>();
  embedded = new Map<string, number[]>();
  imports: unknown[] = [];

  async upsertHsnCodes(rows: UpsertCodeInput[]) {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      if (this.hsnRows.has(row.code)) updated += 1;
      else created += 1;
      this.hsnRows.set(row.code, row);
    }
    return { created, updated };
  }

  async upsertSacCodes(rows: UpsertCodeInput[]) {
    for (const row of rows) this.sacRows.set(row.code, row);
    return { created: rows.length, updated: 0 };
  }

  async findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]> {
    return [...this.hsnRows.values()]
      .filter((r) => r.codeLength === 4 && !this.embedded.has(r.code))
      .slice(0, limit)
      .map((r) => ({ code: r.code, description: r.description }));
  }

  async setHsnEmbedding(code: string, embedding: number[]) {
    this.embedded.set(code, embedding);
  }

  async recordImport(data: unknown) {
    this.imports.push(data);
  }
}

describe("HsnSacImportService.importFromBuffer", () => {
  let repository: FakeReferenceDataRepository;
  let service: HsnSacImportService;

  beforeEach(() => {
    embedMock.mockReset();
    repository = new FakeReferenceDataRepository();
    service = new HsnSacImportService(repository as unknown as IReferenceDataRepository);
  });

  it("upserts both sheets, records the import, and embeds only 4-digit HSN rows", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockResolvedValue([[0.1, 0.2]]);

    const result = await service.importFromBuffer(buffer, "https://example.test/HSN_SAC.xlsx", "etag-1", null);

    expect(result).toEqual({ hsnRowCount: 2, sacRowCount: 1 });
    expect(repository.hsnRows.size).toBe(2);
    expect(repository.sacRows.size).toBe(1);
    expect(repository.imports).toHaveLength(1);
    // Only the 4-digit row (7307) gets embedded — the 2-digit chapter row (73) does not.
    expect(embedMock).toHaveBeenCalledWith(["TUBE OR PIPE FITTINGS, OF IRON OR STEEL"]);
    expect(repository.embedded.has("7307")).toBe(true);
    expect(repository.embedded.has("73")).toBe(false);
  });

  it("rejects a workbook with no readable HSN_MSTR rows", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("HSN_MSTR").addRow(["HSN_CD", "HSN_Description"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(service.importFromBuffer(buffer, "https://example.test", null, null)).rejects.toThrow(
      "HSN_SAC workbook had no readable HSN_MSTR rows.",
    );
    expect(repository.imports).toHaveLength(0);
  });

  it("still upserts and records the import when Ollama is unavailable during embedding", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const result = await service.importFromBuffer(buffer, "https://example.test", "etag-1", null);

    expect(result).toEqual({ hsnRowCount: 2, sacRowCount: 1 });
    expect(repository.imports).toHaveLength(1);
    expect(repository.embedded.size).toBe(0);
  });

  it("does not re-embed a row that's already embedded and whose description hasn't changed", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockResolvedValue([[0.1, 0.2]]);

    await service.importFromBuffer(buffer, "https://example.test", "etag-1", null);
    expect(embedMock).toHaveBeenCalledTimes(1);

    embedMock.mockClear();
    await service.importFromBuffer(buffer, "https://example.test", "etag-2", null);

    expect(embedMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reference-data/__tests__/hsn-sac-import.service.spec.ts`
Expected: FAIL — `Cannot find module '../hsn-sac-import.service.js'` (the module doesn't exist yet).

- [ ] **Step 4: Write `hsn-sac-import.service.ts`**

```ts
import ExcelJS from "exceljs";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";

import type { IReferenceDataRepository, UpsertCodeInput } from "./reference-data.repository.js";

export const CBIC_HSN_SAC_URL = "https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx";
const DATASET_NAME = "HSN_SAC";
/** How many still-unembedded 4-digit HSN headings get embedded per import pass. */
const EMBED_BATCH_LIMIT = 2000;

export interface ParsedWorkbook {
  hsnRows: UpsertCodeInput[];
  sacRows: UpsertCodeInput[];
}

function parseSheet(sheet: ExcelJS.Worksheet | undefined): UpsertCodeInput[] {
  if (!sheet) return [];
  const rows: UpsertCodeInput[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const code = String(row.getCell(1).value ?? "").trim();
    const description = String(row.getCell(2).value ?? "").trim();
    if (!code || !description) return;
    rows.push({ code, description, codeLength: code.length });
  });
  return rows;
}

export async function parseHsnSacWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return {
    hsnRows: parseSheet(workbook.getWorksheet("HSN_MSTR")),
    sacRows: parseSheet(workbook.getWorksheet("SAC_MSTR")),
  };
}

export class HsnSacImportService {
  constructor(private readonly referenceDataRepository: IReferenceDataRepository) {}

  async importFromBuffer(
    buffer: Buffer,
    sourceUrl: string,
    sourceEtag: string | null,
    triggeredById: string | null,
  ): Promise<{ hsnRowCount: number; sacRowCount: number }> {
    const { hsnRows, sacRows } = await parseHsnSacWorkbook(buffer);
    if (hsnRows.length === 0) {
      throw new ServiceUnavailableError("HSN_SAC workbook had no readable HSN_MSTR rows.");
    }

    await this.referenceDataRepository.upsertHsnCodes(hsnRows);
    await this.referenceDataRepository.upsertSacCodes(sacRows);
    await this.referenceDataRepository.recordImport({
      dataset: DATASET_NAME,
      sourceUrl,
      sourceEtag,
      hsnRowCount: hsnRows.length,
      sacRowCount: sacRows.length,
      triggeredById,
    });

    await this.embedPendingHsnCodes();

    return { hsnRowCount: hsnRows.length, sacRowCount: sacRows.length };
  }

  /**
   * Embeds every still-unembedded 4-digit HSN heading — the only rows the matching engine
   * (Task 6) queries. A failure here must not undo the upsert/record above — the rows just stay
   * unembedded for the next pass to pick up (same "one bad step doesn't abandon the rest" rule
   * boq-enrichment.service.ts#enrichBoq already follows).
   */
  private async embedPendingHsnCodes(): Promise<void> {
    const pending = await this.referenceDataRepository.findUnembeddedHsnCodes(EMBED_BATCH_LIMIT);
    if (pending.length === 0) return;

    let vectors: number[][];
    try {
      vectors = await embed(pending.map((row) => row.description));
    } catch (err) {
      logger.warn({ err, count: pending.length }, "Skipped HSN embedding pass (Ollama unavailable)");
      return;
    }
    for (const [index, row] of pending.entries()) {
      const vector = vectors[index];
      if (vector) await this.referenceDataRepository.setHsnEmbedding(row.code, vector);
    }
    logger.info({ count: pending.length }, "Embedded HSN codes");
  }

  async fetchAndImport(
    triggeredById: string | null,
  ): Promise<{ hsnRowCount: number; sacRowCount: number } | null> {
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    const headers: Record<string, string> = {};
    if (latest?.sourceEtag) headers["If-None-Match"] = latest.sourceEtag;

    const response = await fetch(CBIC_HSN_SAC_URL, { headers });
    if (response.status === 304) {
      logger.info("HSN/SAC source unchanged, skipping import");
      return null;
    }
    if (!response.ok) {
      throw new ServiceUnavailableError(`Could not fetch HSN/SAC master list (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const etag = response.headers.get("etag");
    return this.importFromBuffer(buffer, CBIC_HSN_SAC_URL, etag, triggeredById);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/reference-data/__tests__/hsn-sac-import.service.spec.ts`
Expected: `5 passed`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/reference-data/reference-data.repository.ts \
        apps/server/src/modules/reference-data/hsn-sac-import.service.ts \
        apps/server/src/modules/reference-data/__tests__/hsn-sac-import.service.spec.ts
git commit -m "feat(reference-data): HSN/SAC xlsx parsing, upsert, and embedding pipeline"
```

---

### Task 5: One-off seed script

**Files:**
- Create: `apps/server/scripts/import-hsn-sac.ts`

**Interfaces:**
- Consumes: `HsnSacImportService`, `ReferenceDataRepository` from Task 4.

- [ ] **Step 1: Check an existing one-off script for the exact shebang/run convention**

Run: `cat apps/server/scripts/migrate-tender-folders.ts | head -15` and note its imports (`prisma`
client path, how it parses `process.argv`, how it exits).

- [ ] **Step 2: Write `import-hsn-sac.ts`**

```ts
#!/usr/bin/env tsx
/**
 * One-off / manual initial seed for the HSN/SAC reference tables. Usage:
 *   tsx apps/server/scripts/import-hsn-sac.ts [path/to/HSN_SAC.xlsx]
 * With no argument, fetches the live CBIC file (same URL the scheduled job uses).
 */
import { readFile } from "node:fs/promises";

import { prisma } from "../src/infra/prisma/client.js";
import { HsnSacImportService, CBIC_HSN_SAC_URL } from "../src/modules/reference-data/hsn-sac-import.service.js";
import { ReferenceDataRepository } from "../src/modules/reference-data/reference-data.repository.js";

async function main() {
  const filePath = process.argv[2];
  const repository = new ReferenceDataRepository(prisma);
  const service = new HsnSacImportService(repository);

  if (filePath) {
    const buffer = await readFile(filePath);
    const result = await service.importFromBuffer(buffer, `file://${filePath}`, null, null);
    console.log(`Imported from ${filePath}:`, result);
  } else {
    const result = await service.fetchAndImport(null);
    console.log(`Imported from ${CBIC_HSN_SAC_URL}:`, result ?? "unchanged (304)");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Run it against the user's already-downloaded file**

Run: `pnpm --filter @bmp/server exec tsx scripts/import-hsn-sac.ts "/Users/sombuddhachatterjee/Downloads/HSN_SAC.xlsx"`
Expected: `Imported from /Users/sombuddhachatterjee/Downloads/HSN_SAC.xlsx: { hsnRowCount: 21935, sacRowCount: 681 }`
(exact counts may differ slightly if the file has changed since inspection). This seeds real data
before Task 6's matching code is exercised manually.

- [ ] **Step 4: Verify row counts in the database**

Run: `docker exec bmp-postgres-1 psql -U bmp -d bmp -t -c "SELECT count(*) FROM hsn_codes; SELECT count(*) FROM hsn_codes WHERE \"codeLength\"=4 AND \"embeddedAt\" IS NOT NULL;"`
Expected: first count ~21935, second count ~1348 (all 4-digit rows embedded).

- [ ] **Step 5: Commit**

```bash
git add apps/server/scripts/import-hsn-sac.ts
git commit -m "feat(reference-data): one-off HSN/SAC import script"
```

---

### Task 6: Matching engine + confirm-gate fix in BOQ enrichment

**Files:**
- Create: `apps/server/src/modules/reference-data/hsn-matcher.ts`
- Modify: `apps/server/src/modules/boq/boq-enrichment.service.ts`
- Modify: `apps/server/src/modules/boq/boq.module.ts:15-28`
- Modify: `apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts`

**Interfaces:**
- Consumes: `IReferenceDataRepository.findNearestHsn` (Task 4).
- Produces: `BoqEnrichmentService` now takes a 4th constructor argument
  (`referenceDataRepository: IReferenceDataRepository`) — any other construction site must be
  updated too (Task 1's grep already confirmed `boq.module.ts` is the only one).

- [ ] **Step 1: Write `hsn-matcher.ts` (pure functions, same shape as `items.helpers.ts`)**

```ts
export interface HsnMatchCandidate {
  code: string;
  description: string;
}

/**
 * The model is handed a closed list of real, ANN-retrieved HSN headings and MUST return one of
 * their codes, or null. Same "classifies, never defines the vocabulary" rule as
 * items.helpers.ts#parseClassification — this is what makes fabricating a real-but-wrong-chapter
 * code (7310/7318/7321/... for a pipe fitting — the bug this module exists to fix) structurally
 * impossible: the model can only choose among codes actually retrieved as semantically close to
 * this item by the embedding search over real CBIC descriptions.
 */
export function buildHsnMatchPrompt(
  description: string,
  unit: string | null,
  candidates: HsnMatchCandidate[],
): string {
  const options = candidates.map((c) => `  - ${c.code}: ${c.description}`).join("\n");
  return [
    "You classify a construction procurement line item into an Indian HSN (customs tariff)",
    "heading. Choose the single best-fitting heading from the list below — these are the only",
    "real headings retrieved as plausible matches for this item. Never invent a code that isn't",
    "in this list.",
    "",
    `Item description: "${description}"`,
    `Item unit: ${unit ?? "unknown"}`,
    "",
    "Candidate HSN headings:",
    options,
    "",
    'Return JSON only: { "hsnCode": "<one 4-digit code from the list above, or null if none genuinely fit>" }',
  ].join("\n");
}

export function parseHsnMatch(raw: unknown, candidateCodes: Set<string>): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = (raw as Record<string, unknown>).hsnCode;
  const code = typeof candidate === "string" ? candidate.trim() : "";
  return candidateCodes.has(code) ? code : null;
}
```

- [ ] **Step 2: Write the failing tests for the confirm-gate fix and closed-vocabulary rejection**

Open `apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts`. Add near the fake
repository classes (after `FakeItemsRepository`):

```ts
import type {
  HsnCandidate,
  IReferenceDataRepository,
} from "../../reference-data/reference-data.repository.js";

class FakeReferenceDataRepository implements Partial<IReferenceDataRepository> {
  nearestHsn: HsnCandidate[] = [];

  async findNearestHsn(): Promise<HsnCandidate[]> {
    return this.nearestHsn;
  }
}
```

Find the `const service = new BoqEnrichmentService(` construction and add the fake as a 4th
argument:
```ts
  const referenceDataRepository = new FakeReferenceDataRepository();
  const service = new BoqEnrichmentService(
    boqRepository as unknown as IBoqRepository,
    ratesRepository as unknown as IHistoricalRatesRepository,
    itemsRepository as unknown as IItemsRepository,
    referenceDataRepository as unknown as IReferenceDataRepository,
  );
```
(match whatever casts the existing three arguments already use — read the surrounding lines first
and keep the pattern consistent.)

Add two new test cases in the same file, in the `describe` block that covers HSN/GST behavior
(search for `"suggestedHsnCode"` or `"hsnCode"` to find it):

```ts
  it("never writes a fresh (non-catalog) HSN match into the real hsnCode field", async () => {
    generateJsonMock.mockResolvedValue({
      normalizedName: "Pipe Tee 15mm",
      category: "Plumbing",
      subcategory: "Fittings",
      confidence: 0.8,
      hsnCode: null,
      gstRatePercent: 18,
    });
    referenceDataRepository.nearestHsn = [
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", similarity: 0.9 },
    ];
    // A second generateJson call is the HSN-match pick — mock it to return that candidate.
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Pipe Tee 15mm",
      category: "Plumbing",
      subcategory: "Fittings",
      confidence: 0.8,
      hsnCode: null,
      gstRatePercent: 18,
    });
    generateJsonMock.mockResolvedValueOnce({ hsnCode: "7307" });

    const item = makeItem("TEE MATERIAL: MILD STEEL SIZE: 15MM");
    boqRepository.items.set(item.id, item);
    embedMock.mockResolvedValue([CABLE_VECTOR]);

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const enrichment = boqRepository.enrichedById.get(item.id)!;
    expect(enrichment.suggestedHsnCode).toBe("7307");
    expect(enrichment.hsnCode).toBeUndefined();
  });

  it("rejects an HSN code the model returns that wasn't in the offered candidate list", async () => {
    referenceDataRepository.nearestHsn = [
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", similarity: 0.9 },
    ];
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Pipe Tee 15mm",
      category: "Plumbing",
      subcategory: "Fittings",
      confidence: 0.8,
      hsnCode: null,
      gstRatePercent: 18,
    });
    // The model hallucinates a code that was never offered — must be rejected, not stored.
    generateJsonMock.mockResolvedValueOnce({ hsnCode: "9999" });

    const item = makeItem("TEE MATERIAL: MILD STEEL SIZE: 15MM");
    boqRepository.items.set(item.id, item);
    embedMock.mockResolvedValue([CABLE_VECTOR]);

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const enrichment = boqRepository.enrichedById.get(item.id)!;
    expect(enrichment.suggestedHsnCode).toBeNull();
  });

  it("suggests nothing when ANN retrieval finds no HSN candidates at all", async () => {
    referenceDataRepository.nearestHsn = [];
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Unusual Item",
      category: "Other",
      subcategory: null,
      confidence: 0.5,
      hsnCode: null,
      gstRatePercent: 18,
    });

    const item = makeItem("SOME ITEM WITH NO CLEAN HSN ANALOG");
    boqRepository.items.set(item.id, item);
    embedMock.mockResolvedValue([CABLE_VECTOR]);

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const enrichment = boqRepository.enrichedById.get(item.id)!;
    expect(enrichment.suggestedHsnCode).toBeNull();
    // No second generateJson call for the HSN pick — there was nothing to offer it.
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("suggests nothing when the model itself says none of the offered candidates fit", async () => {
    referenceDataRepository.nearestHsn = [
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", similarity: 0.7 },
    ];
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Unusual Item",
      category: "Other",
      subcategory: null,
      confidence: 0.5,
      hsnCode: null,
      gstRatePercent: 18,
    });
    generateJsonMock.mockResolvedValueOnce({ hsnCode: null });

    const item = makeItem("SOME ITEM WITH NO CLEAN HSN ANALOG");
    boqRepository.items.set(item.id, item);
    embedMock.mockResolvedValue([CABLE_VECTOR]);

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const enrichment = boqRepository.enrichedById.get(item.id)!;
    expect(enrichment.suggestedHsnCode).toBeNull();
  });
```

Read the existing test file's `FakeBoqRepository`/`makeItem`/mock-setup conventions first (the
exact shape of `boqRepository.enrichedById`, how `embedMock`/`generateJsonMock` are reset between
tests) and adjust these two new tests' setup to match exactly — the snippets above show the
intent and assertions, not necessarily every existing helper's exact name.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/boq/__tests__/boq-enrichment.service.spec.ts`
Expected: FAIL — `BoqEnrichmentService` doesn't yet accept a 4th constructor argument (TS error)
or the old `classify()` still writes into `hsnCode` unconditionally.

- [ ] **Step 4: Modify `boq-enrichment.service.ts`**

Add the import at the top:
```ts
import { buildHsnMatchPrompt, parseHsnMatch } from "../reference-data/hsn-matcher.js";
import type { IReferenceDataRepository } from "../reference-data/reference-data.repository.js";
```

Add two constants near `LLM_CONTEXT_CANDIDATES`:
```ts
/** Matching only targets 4-digit HSN headings for now — see the design spec's scope boundary. */
const HSN_CODE_LENGTH = 4;
/** How many ANN-retrieved HSN headings the LLM is offered to pick from. */
const HSN_CANDIDATE_LIMIT = 8;
```

Update the constructor:
```ts
export class BoqEnrichmentService {
  constructor(
    private readonly boqRepository: IBoqRepository,
    private readonly ratesRepository: IHistoricalRatesRepository,
    private readonly itemsRepository: IItemsRepository,
    private readonly referenceDataRepository: IReferenceDataRepository,
  ) {}
```

Replace the `classify` method's signature and HSN-related lines. Find:
```ts
  private async classify(
    description: string,
    unit: string | null,
    matches: HistoricalRateMatch[],
    catalogHsn: { hsnCode: string; gstRate: number } | null,
    hsnAlreadyConfirmed: boolean,
  ): Promise<UpdateBoqItemEnrichmentData> {
```
Replace with:
```ts
  private async classify(
    description: string,
    unit: string | null,
    matches: HistoricalRateMatch[],
    catalogHsn: { hsnCode: string; gstRate: number } | null,
    hsnAlreadyConfirmed: boolean,
    vector: number[],
  ): Promise<UpdateBoqItemEnrichmentData> {
```

Find:
```ts
    // A confirmed catalog match always outranks the LLM's own guess for the same call — same
    // "human feedback beats a fresh guess" rule the rate/category matching already use.
    const hsnCode = catalogHsn?.hsnCode ?? parsed.hsnCode;
    const gstRate = catalogHsn?.gstRate ?? parsed.gstRatePercent;
```
Replace with:
```ts
    // A confirmed catalog match always outranks a fresh match for the same call — same "human
    // feedback beats a fresh guess" rule the rate/category matching already use. A fresh match
    // is never trusted enough to become the real hsnCode — see the spread below.
    const freshMatch = catalogHsn ? null : await this.matchHsnCode(description, unit, vector);
    const hsnCode = catalogHsn?.hsnCode ?? null;
    const suggestedHsnCode = catalogHsn?.hsnCode ?? freshMatch?.code ?? null;
    const gstRate = catalogHsn?.gstRate ?? parsed.gstRatePercent;
```

Find:
```ts
      suggestedHsnCode: hsnCode,
      suggestedGstRate: gstRate,
```
Replace with:
```ts
      suggestedHsnCode,
      suggestedGstRate: gstRate,
```

The final spread lines (`...(!hsnAlreadyConfirmed && hsnCode !== null ? { hsnCode } : {})`, etc.)
stay exactly as they are — `hsnCode` is now `catalogHsn?.hsnCode ?? null`, so that spread can only
ever fire from a prior human-confirmed catalog match, never a fresh guess. Update the comment
directly above them to:
```ts
      // hsnCode (the real billing field) is only ever set by an explicit human action — typing
      // over it, clicking Apply on a suggestion, or (here) a catalog match a human already
      // confirmed for this exact item elsewhere. A fresh, never-confirmed match only ever lands
      // in suggestedHsnCode above. Once a human has confirmed one (hsnAlreadyConfirmed), never
      // touch it again — omitting the key (not writing null/undefined explicitly) makes Prisma
      // leave it alone.
```

Add the new private method after `classify`:
```ts
  /**
   * ANN-retrieves real HSN headings close to this item's embedding, then asks the model to pick
   * one of them — never lets it invent a code. See hsn-matcher.ts for why this specific shape
   * makes the wrong-chapter hallucination structurally impossible.
   */
  private async matchHsnCode(
    description: string,
    unit: string | null,
    vector: number[],
  ): Promise<{ code: string; description: string } | null> {
    const candidates = await this.referenceDataRepository.findNearestHsn(
      vector,
      HSN_CODE_LENGTH,
      HSN_CANDIDATE_LIMIT,
    );
    if (candidates.length === 0) return null;

    const raw = await generateJson(
      buildHsnMatchPrompt(description, unit, candidates),
      env.OLLAMA_ENRICHMENT_MODEL,
    );
    const code = parseHsnMatch(raw, new Set(candidates.map((c) => c.code)));
    if (!code) return null;
    const match = candidates.find((c) => c.code === code);
    return match ? { code: match.code, description: match.description } : null;
  }
```

Finally, thread `vector` through the caller. Find in `enrichBoq`:
```ts
        const enrichment = await this.classify(
          item.description,
          item.unit,
          matches,
          catalogHsn,
          item.hsnCodeConfirmed,
        );
```
Replace with:
```ts
        const enrichment = await this.classify(
          item.description,
          item.unit,
          matches,
          catalogHsn,
          item.hsnCodeConfirmed,
          vector,
        );
```

- [ ] **Step 5: Update `boq.module.ts`**

```ts
import { ReferenceDataRepository } from "../reference-data/reference-data.repository.js";
```
(add alongside the other repository imports)

```ts
const referenceDataRepository = new ReferenceDataRepository(prisma);

export const boqEnrichmentService = new BoqEnrichmentService(
  boqRepository,
  historicalRatesRepository,
  itemsRepository,
  referenceDataRepository,
);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/boq/__tests__/boq-enrichment.service.spec.ts`
Expected: all tests pass, including the four new ones (confirm-gate, hallucination-rejection,
no-candidates, model-says-none) and every pre-existing one (the rate/category behavior is
unchanged).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bmp/server exec tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/reference-data/hsn-matcher.ts \
        apps/server/src/modules/boq/boq-enrichment.service.ts \
        apps/server/src/modules/boq/boq.module.ts \
        apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts
git commit -m "feat(boq): ground HSN suggestions in real CBIC data, never auto-apply a fresh guess"
```

---

### Task 7: Reference-data HTTP surface (status / refresh / upload)

**Files:**
- Create: `apps/server/src/modules/reference-data/reference-data.controller.ts`
- Create: `apps/server/src/modules/reference-data/reference-data.routes.ts`
- Create: `apps/server/src/modules/reference-data/reference-data.mapper.ts`
- Create: `apps/server/src/modules/reference-data/reference-data.module.ts`
- Create: `apps/server/src/modules/reference-data/__tests__/reference-data.integration.spec.ts`
- Modify: `apps/server/src/routes/v1.router.ts`

**Interfaces:**
- Consumes: `HsnSacImportService`, `ReferenceDataRepository` (Task 4), `ReferenceDataImportDto`
  (Task 2), `createUploadMiddleware` from `apps/server/src/modules/attachments/upload.middleware.js`,
  `GENERIC_UPLOAD_LIMITS` from `apps/server/src/config/constants.js`.
- Produces: `GET /reference-data/hsn-sac/status`, `POST /reference-data/hsn-sac/refresh`,
  `POST /reference-data/hsn-sac/upload` — consumed by Task 9's frontend hook.

- [ ] **Step 1: Write `reference-data.mapper.ts`**

```ts
import type { ReferenceDataImportDto } from "@bmp/types";

import type { ReferenceDataImportRow } from "./reference-data.repository.js";

export function toReferenceDataImportDto(row: ReferenceDataImportRow): ReferenceDataImportDto {
  return {
    id: row.id,
    dataset: row.dataset,
    sourceUrl: row.sourceUrl,
    hsnRowCount: row.hsnRowCount,
    sacRowCount: row.sacRowCount,
    triggeredByName: row.triggeredBy ? `${row.triggeredBy.firstName} ${row.triggeredBy.lastName}` : null,
    importedAt: row.importedAt.toISOString(),
  };
}
```

- [ ] **Step 2: Write `reference-data.controller.ts`**

```ts
import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import { toReferenceDataImportDto } from "./reference-data.mapper.js";
import type { HsnSacImportService } from "./hsn-sac-import.service.js";
import type { IReferenceDataRepository } from "./reference-data.repository.js";

const DATASET_NAME = "HSN_SAC";

export class ReferenceDataController {
  constructor(
    private readonly hsnSacImportService: HsnSacImportService,
    private readonly referenceDataRepository: IReferenceDataRepository,
  ) {}

  status = asyncHandler(async (_req, res) => {
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    sendSuccess(res, latest ? toReferenceDataImportDto(latest) : null, "HSN/SAC status retrieved");
  });

  refresh = asyncHandler(async (req, res) => {
    await this.hsnSacImportService.fetchAndImport(req.user!.id);
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    if (!latest) throw new NotFoundError("No import recorded after refresh");
    sendSuccess(res, toReferenceDataImportDto(latest), "HSN/SAC data refreshed");
  });

  upload = asyncHandler(async (req, res) => {
    if (!req.file) throw new NotFoundError("No file provided");
    await this.hsnSacImportService.importFromBuffer(
      req.file.buffer,
      `upload:${req.file.originalname}`,
      null,
      req.user!.id,
    );
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    if (!latest) throw new NotFoundError("No import recorded after upload");
    sendSuccess(res, toReferenceDataImportDto(latest), "HSN/SAC data imported", 201);
  });
}
```

(`NotFoundError` for the "no import recorded" cases is a defensive 404 that should never actually
fire in practice — `fetchAndImport`/`importFromBuffer` either throw `ServiceUnavailableError`
themselves or successfully record an import; it exists only so the return type is never
`Dto | null` on the mutating endpoints.)

- [ ] **Step 3: Write `reference-data.routes.ts`**

```ts
import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { ReferenceDataController } from "./reference-data.controller.js";

export function createReferenceDataRouter(controller: ReferenceDataController): Router {
  const router = Router();
  const uploadHsnSacFile = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/status:
   *   get:
   *     tags: [ReferenceData]
   *     summary: Latest HSN/SAC reference data import status
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Latest import, or null if none has ever run }
   */
  router.get(
    "/hsn-sac/status",
    authenticateMiddleware,
    requirePermission("settings:read"),
    controller.status,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/refresh:
   *   post:
   *     tags: [ReferenceData]
   *     summary: Fetch the latest CBIC HSN/SAC master list now and re-import if it changed
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated (or unchanged) import status }
   */
  router.post(
    "/hsn-sac/refresh",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    controller.refresh,
  );

  /**
   * @openapi
   * /reference-data/hsn-sac/upload:
   *   post:
   *     tags: [ReferenceData]
   *     summary: Import a manually-provided HSN_SAC.xlsx file
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *     responses:
   *       201: { description: Import result }
   */
  router.post(
    "/hsn-sac/upload",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    uploadHsnSacFile,
    controller.upload,
  );

  return router;
}
```

Before writing this, check `createUploadMiddleware`'s exact parameter order and name by reading
`apps/server/src/modules/attachments/upload.middleware.ts` in full — the snippet above assumes
`(fieldName, maxSizeBytes, allowedMimeTypes)` based on the tenders.routes.ts call site; confirm
against the actual signature and adjust argument order if it differs.

- [ ] **Step 4: Write `reference-data.module.ts`**

```ts
import { prisma } from "../../infra/prisma/client.js";

import { HsnSacImportService } from "./hsn-sac-import.service.js";
import { ReferenceDataController } from "./reference-data.controller.js";
import { ReferenceDataRepository } from "./reference-data.repository.js";
import { createReferenceDataRouter } from "./reference-data.routes.js";

export const referenceDataRepository = new ReferenceDataRepository(prisma);
export const hsnSacImportService = new HsnSacImportService(referenceDataRepository);
const referenceDataController = new ReferenceDataController(hsnSacImportService, referenceDataRepository);

export const referenceDataRouter = createReferenceDataRouter(referenceDataController);
```

- [ ] **Step 5: Mount the router**

In `apps/server/src/routes/v1.router.ts`, add the import alongside the others and mount it:
```ts
v1Router.use("/reference-data", referenceDataRouter);
```
(match the existing import-and-mount style exactly — see the surrounding lines for `itemsRouter`.)

- [ ] **Step 6: Write the integration test**

Create `apps/server/src/modules/reference-data/__tests__/reference-data.integration.spec.ts`,
following the structure of `apps/server/src/modules/boq/__tests__/boq.integration.spec.ts` (real
supertest app, real test Postgres, a logged-in SUPER_ADMIN session):

```ts
import { describe, expect, it } from "vitest";

import { app } from "../../../app.js";
import { loginAsSuperAdmin } from "../../../test-utils/auth.js"; // confirm exact helper name/path
                                                                    // by reading boq.integration.spec.ts
import { prisma } from "../../../infra/prisma/client.js";

describe("Reference data HSN/SAC upload (integration)", () => {
  it("uploads a small fixture workbook and makes it show up in status", async () => {
    const { agent } = await loginAsSuperAdmin(app);

    // Build a minimal real xlsx in-memory — same fixture shape as the unit test.
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const hsn = workbook.addWorksheet("HSN_MSTR");
    hsn.addRow(["HSN_CD", "HSN_Description"]);
    hsn.addRow(["7307", "TUBE OR PIPE FITTINGS, OF IRON OR STEEL"]);
    workbook.addWorksheet("SAC_MSTR").addRow(["SAC_CD", "SAC_Description"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const uploadRes = await agent
      .post("/api/v1/reference-data/hsn-sac/upload")
      .attach("file", buffer, "HSN_SAC.xlsx");
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.hsnRowCount).toBe(1);

    const statusRes = await agent.get("/api/v1/reference-data/hsn-sac/status");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.hsnRowCount).toBe(1);

    const stored = await prisma.hsnCode.findUnique({ where: { code: "7307" } });
    expect(stored?.description).toBe("TUBE OR PIPE FITTINGS, OF IRON OR STEEL");
  });
});
```

Read an existing integration spec first (`boq.integration.spec.ts` or `tenders.integration.spec.ts`)
to confirm the exact app-import path, the login-helper name and signature, and how other
integration tests clean up rows between runs — adjust the snippet above to match those exact
conventions rather than guessing.

- [ ] **Step 7: Run the integration test**

Run: `pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/reference-data/__tests__/reference-data.integration.spec.ts`
(requires `docker compose up -d postgres redis minio minio-init` first, per this repo's testing
conventions)
Expected: `1 passed`.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server exec tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/reference-data/reference-data.controller.ts \
        apps/server/src/modules/reference-data/reference-data.routes.ts \
        apps/server/src/modules/reference-data/reference-data.mapper.ts \
        apps/server/src/modules/reference-data/reference-data.module.ts \
        apps/server/src/modules/reference-data/__tests__/reference-data.integration.spec.ts \
        apps/server/src/routes/v1.router.ts
git commit -m "feat(reference-data): status/refresh/upload endpoints"
```

---

### Task 8: Scheduled weekly refresh (BullMQ)

**Files:**
- Modify: `apps/server/src/infra/queue/queues.ts`
- Create: `apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts`
- Modify: `apps/server/src/worker.ts`

**Interfaces:**
- Consumes: `hsnSacImportService` (Task 7's module), `settingsService.get("HSN_SAC_AUTO_REFRESH_ENABLED")`
  (Task 9 is what actually builds and wires `settingsService`; this task reads the setting but
  must temporarily stub it until Task 9 runs — see Step 4).

- [ ] **Step 1: Add the queue to `queues.ts`**

Add at the end of the file:
```ts
export const HSN_SAC_REFRESH_QUEUE_NAME = "hsn-sac-refresh";

export const hsnSacRefreshQueue = new Queue<Record<string, never>, void, "refresh">(
  HSN_SAC_REFRESH_QUEUE_NAME,
  { connection: redis },
);
```

- [ ] **Step 2: Write the worker**

```ts
import { Worker } from "bullmq";

import { hsnSacImportService } from "../../../modules/reference-data/reference-data.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { redis } from "../../redis/client.js";
import { HSN_SAC_REFRESH_QUEUE_NAME } from "../queues.js";

export function startHsnSacRefreshWorker(): Worker {
  const worker = new Worker(
    HSN_SAC_REFRESH_QUEUE_NAME,
    async () => {
      const result = await hsnSacImportService.fetchAndImport(null);
      if (result) {
        logger.info(result, "Scheduled HSN/SAC refresh imported new data");
      } else {
        logger.info("Scheduled HSN/SAC refresh: source unchanged");
      }
    },
    { connection: redis },
  );
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "HSN/SAC refresh job failed");
  });
  return worker;
}
```

- [ ] **Step 3: Register it in `worker.ts`**

Add the import:
```ts
import { hsnSacRefreshQueue } from "./infra/queue/queues.js";
import { startHsnSacRefreshWorker } from "./infra/queue/workers/hsn-sac-refresh.worker.js";
```

Add alongside the other worker starts:
```ts
const hsnSacRefreshWorker = startHsnSacRefreshWorker();
```

Add alongside the other repeatable-job registrations (near `tenderReminderQueue.add(...)`):
```ts
// Idempotent — see the comment above the tender-reminder registration for why re-registering on
// every boot is safe and required. Sundays 03:00 — this data changes rarely (GST Council
// notifications, not daily), so a weekly cadence is deliberately not configurable via env; the
// per-run enable/disable toggle lives in Settings (HSN_SAC_AUTO_REFRESH_ENABLED).
await hsnSacRefreshQueue.add("refresh", {}, { repeat: { pattern: "0 3 * * 0" }, jobId: "hsn-sac-weekly-refresh" });
```

- [ ] **Step 4: Gate the worker body on the setting (temporary env-only version)**

Until Task 9 wires the real `SettingsService`, gate the worker's job body on a plain constant so
the file compiles and behaves sensibly if Task 8 runs before Task 9:
```ts
    async () => {
      // TODO(Task 9): read this from SettingsService.get("HSN_SAC_AUTO_REFRESH_ENABLED") instead.
      const autoRefreshEnabled = true;
      if (!autoRefreshEnabled) return;
      const result = await hsnSacImportService.fetchAndImport(null);
      ...
```
Task 9 Step 12 replaces this `TODO` with the real settings read — do not leave the TODO in the
final merged state; if executing tasks in order, that step removes it.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bmp/server exec tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 6: Manually verify the repeat registration**

Run: `pnpm --filter @bmp/server exec tsx src/worker.ts &` then, after a few seconds,
`docker exec bmp-redis-1 redis-cli KEYS "bull:hsn-sac-refresh:*"` (adjust the redis container name
if different — check with `docker compose ps`). Expected: at least one key referencing the
`hsn-sac-weekly-refresh` repeatable job. Stop the worker afterward (`kill %1` or `fg` + Ctrl-C).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/infra/queue/queues.ts \
        apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts \
        apps/server/src/worker.ts
git commit -m "feat(reference-data): weekly scheduled HSN/SAC refresh via BullMQ"
```

---

### Task 9: Settings backend (repository, service, registry, RBAC-gated routes)

**Files:**
- Create: `apps/server/src/modules/settings/settings.registry.ts`
- Create: `apps/server/src/modules/settings/settings.repository.ts`
- Create: `apps/server/src/modules/settings/settings.service.ts`
- Create: `apps/server/src/modules/settings/settings.validation.ts`
- Create: `apps/server/src/modules/settings/settings.controller.ts`
- Create: `apps/server/src/modules/settings/settings.routes.ts`
- Create: `apps/server/src/modules/settings/settings.module.ts`
- Create: `apps/server/src/modules/settings/__tests__/settings.service.spec.ts`
- Modify: `apps/server/src/routes/v1.router.ts`
- Modify: `apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts` (removes Task 8's TODO)
- Modify: `apps/server/src/modules/boq/boq-enrichment.service.ts` (wires live `AI_MATCH_THRESHOLD`)

**Interfaces:**
- Produces: `settingsService` singleton (`get<T>(key)`, `set(key, value, actorId)`, `listAll()`) —
  consumed by Task 8's worker (now finished) and Task 10's frontend.

- [ ] **Step 1: Write `settings.registry.ts`**

```ts
import type { SettingKey, SettingValueType } from "@bmp/types";

import { env } from "../../config/env.js";

export interface SettingDefinition {
  type: SettingValueType;
  defaultValue: string | number | boolean;
  label: string;
  group: string;
}

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  TENDER_NOTES_AI_ENABLED: {
    type: "boolean",
    defaultValue: env.TENDER_NOTES_AI_ENABLED,
    label: "AI-clean Terms & Notes on tender extraction",
    group: "AI & Extraction",
  },
  AI_ENRICHMENT_ENABLED: {
    type: "boolean",
    defaultValue: env.AI_ENRICHMENT_ENABLED,
    label: "Background BOQ enrichment (classification, rate & HSN suggestions)",
    group: "AI & Extraction",
  },
  OLLAMA_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_MODEL,
    label: "Ollama model (tender extraction)",
    group: "AI & Extraction",
  },
  OLLAMA_EMBED_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_EMBED_MODEL,
    label: "Ollama embedding model",
    group: "AI & Extraction",
  },
  OLLAMA_ENRICHMENT_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_ENRICHMENT_MODEL,
    label: "Ollama model (item/HSN classification)",
    group: "AI & Extraction",
  },
  OLLAMA_BASE_URL: {
    type: "string",
    defaultValue: env.OLLAMA_BASE_URL,
    label: "Ollama base URL",
    group: "AI & Extraction",
  },
  AI_MATCH_THRESHOLD: {
    type: "number",
    defaultValue: env.AI_MATCH_THRESHOLD,
    label: "Minimum cosine similarity to auto-reuse a confirmed match",
    group: "AI & Extraction",
  },
  AI_CONTEXT_FLOOR: {
    type: "number",
    defaultValue: env.AI_CONTEXT_FLOOR,
    label: "Minimum similarity to show a candidate to the model at all",
    group: "AI & Extraction",
  },
  DOCUMENT_MATCH_THRESHOLD: {
    type: "number",
    defaultValue: env.DOCUMENT_MATCH_THRESHOLD,
    label: "Minimum similarity for a document search match",
    group: "AI & Extraction",
  },
  LOCAL_DOCS_SYNC_ENABLED: {
    type: "boolean",
    defaultValue: env.LOCAL_DOCS_SYNC_ENABLED,
    label: "Watch local folder and auto-attach dropped files to tenders",
    group: "Document Sync",
  },
  INCOMING_TENDERS_INGESTION_ENABLED: {
    type: "boolean",
    defaultValue: env.INCOMING_TENDERS_INGESTION_ENABLED,
    label: "Auto-create tenders from dropped files",
    group: "Document Sync",
  },
  DOCUMENT_INDEXING_ENABLED: {
    type: "boolean",
    defaultValue: env.DOCUMENT_INDEXING_ENABLED,
    label: "Index uploaded documents for search",
    group: "Document Sync",
  },
  ASSISTANT_TIMEZONE: {
    type: "string",
    defaultValue: env.ASSISTANT_TIMEZONE,
    label: "Assistant timezone",
    group: "Assistant",
  },
  ACCESS_TOKEN_TTL_MINUTES: {
    type: "number",
    defaultValue: env.ACCESS_TOKEN_TTL_MINUTES,
    label: "Access token lifetime (minutes)",
    group: "Authentication",
  },
  REFRESH_TOKEN_TTL_DAYS: {
    type: "number",
    defaultValue: env.REFRESH_TOKEN_TTL_DAYS,
    label: "Refresh token lifetime (days)",
    group: "Authentication",
  },
  PASSWORD_RESET_TOKEN_TTL_MINUTES: {
    type: "number",
    defaultValue: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    label: "Password reset link lifetime (minutes)",
    group: "Authentication",
  },
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: {
    type: "number",
    defaultValue: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
    label: "Email verification link lifetime (hours)",
    group: "Authentication",
  },
  HSN_SAC_AUTO_REFRESH_ENABLED: {
    type: "boolean",
    defaultValue: true,
    label: "Automatically refresh HSN/SAC codes weekly from CBIC",
    group: "Reference Data",
  },
};
```

- [ ] **Step 2: Write `settings.repository.ts`**

```ts
import type { Prisma, PrismaClient } from "@bmp/database";

export interface SettingRow {
  key: string;
  value: string;
  updatedBy: { id: string; firstName: string; lastName: string } | null;
  updatedAt: Date;
}

const settingWithUpdaterArgs = {
  include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.SettingDefaultArgs;

export interface ISettingsRepository {
  findAll(): Promise<SettingRow[]>;
  findByKey(key: string): Promise<SettingRow | null>;
  upsert(key: string, value: string, updatedById: string): Promise<SettingRow>;
}

export class SettingsRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<SettingRow[]> {
    return this.prisma.setting.findMany(settingWithUpdaterArgs);
  }

  findByKey(key: string): Promise<SettingRow | null> {
    return this.prisma.setting.findUnique({ where: { key }, ...settingWithUpdaterArgs });
  }

  upsert(key: string, value: string, updatedById: string): Promise<SettingRow> {
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedById },
      update: { value, updatedById },
      ...settingWithUpdaterArgs,
    });
  }
}
```

- [ ] **Step 3: Write the failing test for `SettingsService`**

Create `apps/server/src/modules/settings/__tests__/settings.service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ISettingsRepository, SettingRow } from "../settings.repository.js";
import { SettingsService } from "../settings.service.js";

class FakeSettingsRepository implements ISettingsRepository {
  rows = new Map<string, SettingRow>();

  async findAll(): Promise<SettingRow[]> {
    return [...this.rows.values()];
  }

  async findByKey(key: string): Promise<SettingRow | null> {
    return this.rows.get(key) ?? null;
  }

  async upsert(key: string, value: string, updatedById: string): Promise<SettingRow> {
    const row: SettingRow = {
      key,
      value,
      updatedBy: { id: updatedById, firstName: "Super", lastName: "Admin" },
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }
}

describe("SettingsService", () => {
  let repository: FakeSettingsRepository;
  let auditLog: ReturnType<typeof vi.fn>;
  let service: SettingsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeSettingsRepository();
    auditLog = vi.fn().mockResolvedValue(undefined);
    service = new SettingsService(repository, { log: auditLog } as unknown as AuditService);
  });

  it("falls back to the env-derived default when no row exists", async () => {
    const value = await service.get<number>("AI_MATCH_THRESHOLD");
    expect(value).toBe(0.98);
  });

  it("returns the stored value once set, and audit-logs the write", async () => {
    await service.set("AI_MATCH_THRESHOLD", 0.95, actorId);

    const value = await service.get<number>("AI_MATCH_THRESHOLD");
    expect(value).toBe(0.95);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: "SETTING_UPDATED",
        entityType: "Setting",
        entityId: "AI_MATCH_THRESHOLD",
        metadata: { key: "AI_MATCH_THRESHOLD", value: 0.95 },
      }),
    );
  });

  it("rejects a non-number value for a number-typed setting", async () => {
    await expect(
      service.set("AI_MATCH_THRESHOLD", "not-a-number" as unknown as number, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("lists every setting key, overridden or not", async () => {
    await service.set("HSN_SAC_AUTO_REFRESH_ENABLED", false, actorId);

    const all = await service.listAll();
    const overridden = all.find((s) => s.key === "HSN_SAC_AUTO_REFRESH_ENABLED")!;
    const notOverridden = all.find((s) => s.key === "AI_CONTEXT_FLOOR")!;

    expect(overridden.value).toBe(false);
    expect(overridden.isOverridden).toBe(true);
    expect(notOverridden.value).toBe(0.75);
    expect(notOverridden.isOverridden).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/settings/__tests__/settings.service.spec.ts`
Expected: FAIL — `Cannot find module '../settings.service.js'`.

- [ ] **Step 5: Write `settings.service.ts`**

```ts
import type { SettingDto, SettingKey } from "@bmp/types";
import { SETTING_KEYS } from "@bmp/types";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import type { AuditService } from "../audit/audit.service.js";

import { SETTING_DEFINITIONS } from "./settings.registry.js";
import type { ISettingsRepository, SettingRow } from "./settings.repository.js";

function parseValue(raw: string, type: "string" | "number" | "boolean"): string | number | boolean {
  if (type === "boolean") return raw === "true";
  if (type === "number") return Number(raw);
  return raw;
}

function serializeValue(value: string | number | boolean): string {
  return String(value);
}

function toDto(key: SettingKey, row: SettingRow | null): SettingDto {
  const def = SETTING_DEFINITIONS[key];
  return {
    key,
    type: def.type,
    label: def.label,
    group: def.group,
    value: row ? parseValue(row.value, def.type) : def.defaultValue,
    isOverridden: row !== null,
    updatedByName: row?.updatedBy ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}` : null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export class SettingsService {
  constructor(
    private readonly settingsRepository: ISettingsRepository,
    private readonly auditService: AuditService,
  ) {}

  async listAll(): Promise<SettingDto[]> {
    const rows = await this.settingsRepository.findAll();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SETTING_KEYS.map((key) => toDto(key, byKey.get(key) ?? null));
  }

  /** Typed read for server-side callers — falls back to the env-derived default. */
  async get<T extends string | number | boolean>(key: SettingKey): Promise<T> {
    const row = await this.settingsRepository.findByKey(key);
    const def = SETTING_DEFINITIONS[key];
    return (row ? parseValue(row.value, def.type) : def.defaultValue) as T;
  }

  async set(key: SettingKey, value: string | number | boolean, actorId: string): Promise<SettingDto> {
    const def = SETTING_DEFINITIONS[key];
    if (def.type === "number" && (typeof value !== "number" || Number.isNaN(value))) {
      throw new BadRequestError(`${key} must be a number`);
    }
    if (def.type === "boolean" && typeof value !== "boolean") {
      throw new BadRequestError(`${key} must be a boolean`);
    }
    if (def.type === "string" && typeof value !== "string") {
      throw new BadRequestError(`${key} must be a string`);
    }
    const row = await this.settingsRepository.upsert(key, serializeValue(value), actorId);
    await this.auditService.log({
      actorId,
      action: "SETTING_UPDATED",
      entityType: "Setting",
      entityId: key,
      metadata: { key, value },
    });
    return toDto(key, row);
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @bmp/server exec vitest run src/modules/settings/__tests__/settings.service.spec.ts`
Expected: `4 passed`.

- [ ] **Step 7: Write `settings.validation.ts`**

```ts
import { SETTING_KEYS } from "@bmp/types";
import { z } from "zod";

export const settingKeyParamSchema = z.object({
  key: z.enum(SETTING_KEYS),
});
export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;

export const updateSettingBodySchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type UpdateSettingBody = z.infer<typeof updateSettingBodySchema>;
```

- [ ] **Step 8: Write `settings.controller.ts`**

```ts
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { SettingKeyParam, UpdateSettingBody } from "./settings.validation.js";
import type { SettingsService } from "./settings.service.js";

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  list = asyncHandler(async (_req, res) => {
    const settings = await this.settingsService.listAll();
    sendSuccess(res, settings, "Settings retrieved");
  });

  update = asyncHandler(async (req, res) => {
    const { key } = req.params as unknown as SettingKeyParam;
    const body = req.body as UpdateSettingBody;
    const setting = await this.settingsService.set(key, body.value, req.user!.id);
    sendSuccess(res, setting, "Setting updated");
  });
}
```

- [ ] **Step 9: Write `settings.routes.ts`**

```ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { SettingsController } from "./settings.controller.js";
import { settingKeyParamSchema, updateSettingBodySchema } from "./settings.validation.js";

export function createSettingsRouter(controller: SettingsController): Router {
  const router = Router();

  /**
   * @openapi
   * /settings:
   *   get:
   *     tags: [Settings]
   *     summary: List all system settings with their current effective value
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: All settings, grouped }
   */
  router.get("/", authenticateMiddleware, requirePermission("settings:read"), controller.list);

  /**
   * @openapi
   * /settings/{key}:
   *   patch:
   *     tags: [Settings]
   *     summary: Update one system setting
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Updated setting }
   */
  router.patch(
    "/:key",
    authenticateMiddleware,
    requirePermission("settings:manage"),
    validate(settingKeyParamSchema, "params"),
    validate(updateSettingBodySchema),
    controller.update,
  );

  return router;
}
```

- [ ] **Step 10: Write `settings.module.ts`**

```ts
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { SettingsController } from "./settings.controller.js";
import { SettingsRepository } from "./settings.repository.js";
import { createSettingsRouter } from "./settings.routes.js";
import { SettingsService } from "./settings.service.js";

const settingsRepository = new SettingsRepository(prisma);
export const settingsService = new SettingsService(settingsRepository, auditService);
const settingsController = new SettingsController(settingsService);

export const settingsRouter = createSettingsRouter(settingsController);
```

- [ ] **Step 11: Mount the router**

In `apps/server/src/routes/v1.router.ts`:
```ts
v1Router.use("/settings", settingsRouter);
```

- [ ] **Step 12: Wire the real setting into the refresh worker (removes Task 8's TODO)**

In `apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts`, replace:
```ts
      // TODO(Task 10): read this from SettingsService.get("HSN_SAC_AUTO_REFRESH_ENABLED") instead.
      const autoRefreshEnabled = true;
      if (!autoRefreshEnabled) return;
```
with:
```ts
      const autoRefreshEnabled = await settingsService.get<boolean>("HSN_SAC_AUTO_REFRESH_ENABLED");
      if (!autoRefreshEnabled) return;
```
and add the import:
```ts
import { settingsService } from "../../../modules/settings/settings.module.js";
```

- [ ] **Step 13: Wire live `AI_MATCH_THRESHOLD` into `boq-enrichment.service.ts`**

Add the constructor dependency:
```ts
export class BoqEnrichmentService {
  constructor(
    private readonly boqRepository: IBoqRepository,
    private readonly ratesRepository: IHistoricalRatesRepository,
    private readonly itemsRepository: IItemsRepository,
    private readonly referenceDataRepository: IReferenceDataRepository,
    private readonly settingsService: SettingsService,
  ) {}
```
Add the import:
```ts
import type { SettingsService } from "../settings/settings.service.js";
```
In `classify()`, find:
```ts
    const matched =
      best !== undefined &&
      best.similarity >= env.AI_MATCH_THRESHOLD &&
```
Replace with:
```ts
    const matchThreshold = await this.settingsService.get<number>("AI_MATCH_THRESHOLD");
    const matched =
      best !== undefined &&
      best.similarity >= matchThreshold &&
```
Update `boq.module.ts` to pass the singleton:
```ts
import { settingsService } from "../settings/settings.module.js";
```
```ts
export const boqEnrichmentService = new BoqEnrichmentService(
  boqRepository,
  historicalRatesRepository,
  itemsRepository,
  referenceDataRepository,
  settingsService,
);
```
Update `boq-enrichment.service.spec.ts`'s service construction to pass a 5th fake
(`{ get: vi.fn().mockResolvedValue(0.98) } as unknown as SettingsService`, or a small
`FakeSettingsService` class returning `AI_MATCH_THRESHOLD: 0.98` — match whatever style the file's
other fakes already use) so the existing threshold-dependent tests keep passing unchanged.

- [ ] **Step 14: Run the full server test suite**

Run: `pnpm --filter @bmp/server exec vitest run --exclude "**/*.integration.spec.ts"`
Expected: every test passes, including `boq-enrichment.service.spec.ts` (now with the 5th
constructor arg) and the new `settings.service.spec.ts`.

- [ ] **Step 15: Typecheck**

Run: `pnpm --filter @bmp/server exec tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 16: Commit**

```bash
git add apps/server/src/modules/settings apps/server/src/routes/v1.router.ts \
        apps/server/src/infra/queue/workers/hsn-sac-refresh.worker.ts \
        apps/server/src/modules/boq/boq-enrichment.service.ts \
        apps/server/src/modules/boq/boq.module.ts \
        apps/server/src/modules/boq/__tests__/boq-enrichment.service.spec.ts
git commit -m "feat(settings): backend service/routes; wire live reads into HSN refresh and match threshold"
```

**Note on scope:** the remaining 15 settings (everything except `HSN_SAC_AUTO_REFRESH_ENABLED` and
`AI_MATCH_THRESHOLD`) are stored, audited, and editable through this API and Task 10's UI, but
their consumers (`env.OLLAMA_MODEL`, `env.TENDER_NOTES_AI_ENABLED`, etc.) still read the static
`env` object directly — changing them in Settings will not take effect until each remaining
consumer is individually migrated to call `settingsService.get(...)` and the process is restarted.
This is a deliberate scope cut (see the spec's "explicit scope boundaries" and this plan's Task 9
step 12-13 as the two call sites actually wired live) — do not claim the other 15 are dynamically
live; say so plainly if asked.

---

### Task 10: Frontend — reference-data hook, settings hook, Settings page, HSN Apply button

**Files:**
- Create: `apps/web/src/hooks/use-reference-data.ts`
- Create: `apps/web/src/hooks/use-settings.ts`
- Create: `apps/web/src/app/(dashboard)/settings/page.tsx`
- Modify: `apps/web/src/components/boq/boq-item-grid.tsx`

**Interfaces:**
- Consumes: `ReferenceDataImportDto`, `SettingDto`, `SettingKey` from `@bmp/types`; `apiClient`
  from `@/lib/axios`; `hasPermission` from `@/lib/permissions`.

- [ ] **Step 1: Write `use-reference-data.ts`**

```ts
"use client";

import type { ApiResponse, ReferenceDataImportDto } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useHsnSacStatus() {
  return useQuery({
    queryKey: ["reference-data", "hsn-sac", "status"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ReferenceDataImportDto | null>>(
        "/reference-data/hsn-sac/status",
      );
      return unwrap(response.data);
    },
  });
}

export function useRefreshHsnSac() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<ApiResponse<ReferenceDataImportDto>>(
        "/reference-data/hsn-sac/refresh",
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "hsn-sac", "status"] });
    },
  });
}

export function useUploadHsnSac() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiClient.post<ApiResponse<ReferenceDataImportDto>>(
        "/reference-data/hsn-sac/upload",
        formData,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reference-data", "hsn-sac", "status"] });
    },
  });
}
```

- [ ] **Step 2: Write `use-settings.ts`**

```ts
"use client";

import type { ApiResponse, SettingDto, SettingKey } from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<SettingDto[]>>("/settings");
      return unwrap(response.data);
    },
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: SettingKey; value: string | number | boolean }) => {
      const response = await apiClient.patch<ApiResponse<SettingDto>>(`/settings/${key}`, { value });
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
```

- [ ] **Step 3: Find an existing card/toggle/input pattern to reuse**

Run: `grep -n "^export" packages/ui/src/components/*.tsx | grep -iE "switch|toggle"` and
`grep -n "^export" packages/ui/src/index.ts | grep -iE "card|switch|input"` — the Settings page
must reuse `@bmp/ui`'s existing `Card`/`Switch`/`Input`/`Badge`/`Button` components exactly as
every other dashboard page does (see `apps/web/src/components/tenders/tender-documents-tab.tsx`
for a recent example of the same import style), never introduce new primitives.

- [ ] **Step 4: Write the Settings page**

```tsx
"use client";

import type { SettingDto } from "@bmp/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Switch, useToast } from "@bmp/ui";
import { RefreshCw, Upload } from "lucide-react";
import { useRef } from "react";

import { useHsnSacStatus, useRefreshHsnSac, useUploadHsnSac } from "@/hooks/use-reference-data";
import { useSettings, useUpdateSetting } from "@/hooks/use-settings";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

function HsnSacCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const statusQuery = useHsnSacStatus();
  const refresh = useRefreshHsnSac();
  const upload = useUploadHsnSac();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleRefresh() {
    try {
      await refresh.mutateAsync();
      toast({ title: "HSN/SAC data refreshed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not refresh HSN/SAC data",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync(file);
      toast({ title: "HSN/SAC data imported" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import file",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">HSN/SAC reference data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : statusQuery.data ? (
          <div className="text-sm text-muted-foreground">
            <p>
              {statusQuery.data.hsnRowCount.toLocaleString()} HSN / {statusQuery.data.sacRowCount.toLocaleString()} SAC
              codes · last imported {new Date(statusQuery.data.importedAt).toLocaleString()}
              {statusQuery.data.triggeredByName ? ` by ${statusQuery.data.triggeredByName}` : " (scheduled)"}
            </p>
            <p className="mt-1 truncate">Source: {statusQuery.data.sourceUrl}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No import has run yet.</p>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void handleRefresh()} disabled={refresh.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh now
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleUpload(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="mr-2 h-4 w-4" /> Upload file
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingControl({ setting, canManage }: { setting: SettingDto; canManage: boolean }) {
  const { toast } = useToast();
  const update = useUpdateSetting();

  async function commit(value: string | number | boolean) {
    try {
      await update.mutateAsync({ key: setting.key, value });
    } catch (error) {
      toast({
        variant: "destructive",
        title: `Could not update ${setting.label}`,
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm">{setting.label}</p>
        {setting.isOverridden && setting.updatedByName && (
          <p className="text-xs text-muted-foreground">Customized by {setting.updatedByName}</p>
        )}
      </div>
      {setting.type === "boolean" ? (
        <Switch
          checked={setting.value as boolean}
          disabled={!canManage || update.isPending}
          onCheckedChange={(checked) => void commit(checked)}
        />
      ) : (
        <Input
          className="w-40"
          type={setting.type === "number" ? "number" : "text"}
          defaultValue={String(setting.value)}
          disabled={!canManage || update.isPending}
          onBlur={(e) => {
            const raw = e.target.value;
            const parsed = setting.type === "number" ? Number(raw) : raw;
            if (parsed !== setting.value) void commit(parsed);
          }}
        />
      )}
    </div>
  );
}

export default function SettingsPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canRead = hasPermission(roleName, "settings:read");
  const canManage = hasPermission(roleName, "settings:manage");
  const settingsQuery = useSettings();

  if (!canRead) {
    return <p className="text-sm text-muted-foreground">You don't have access to system settings.</p>;
  }

  const groups = new Map<string, SettingDto[]>();
  for (const setting of settingsQuery.data ?? []) {
    const list = groups.get(setting.group) ?? [];
    list.push(setting);
    groups.set(setting.group, list);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration — visible and editable by administrators only.</p>
      </div>

      <HsnSacCard canManage={canManage} />

      {settingsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        [...groups.entries()].map(([group, settings]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base">{group}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {settings.map((setting) => (
                <SettingControl key={setting.key} setting={setting} canManage={canManage} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

Before finalizing this file, confirm `Switch` is exported from `@bmp/ui` (Step 3's grep) — if it
isn't, use whatever boolean-toggle primitive the package does export (check
`packages/ui/src/index.ts` for the actual name) and adjust the import/usage accordingly rather
than inventing a new component.

- [ ] **Step 5: Add the HSN suggestion + Apply UI to `boq-item-grid.tsx`**

Find the `hsnCode` column definition:
```ts
    {
      key: "hsnCode",
      header: "HSN Code",
      editable: canEdit,
      inputType: "number",
      widthClassName: "w-28",
      getValue: (item) => item.hsnCode ?? "",
      onCommit: (item, value) => void commitField(item, "hsnCode", value),
    },
```
Replace with:
```ts
    {
      key: "hsnCode",
      header: "HSN Code",
      editable: canEdit,
      inputType: "number",
      widthClassName: "w-32",
      getValue: (item) => item.hsnCode ?? "",
      onCommit: (item, value) => void commitField(item, "hsnCode", value),
      render: (item) => (
        <div className="space-y-1">
          <span>{item.hsnCode ?? "-"}</span>
          {item.suggestedHsnCode && item.suggestedHsnCode !== item.hsnCode && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Suggested: {item.suggestedHsnCode}</span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-xs"
                  onClick={() => void commitField(item, "hsnCode", item.suggestedHsnCode!)}
                >
                  Apply
                </Button>
              )}
            </div>
          )}
        </div>
      ),
    },
```

Before writing this, check `EditableTreeColumn`'s type in `packages/ui` to confirm a column can
have both `editable`/`onCommit` (for the inline text-edit path) and a custom `render` (for the
read/suggestion display) at once — if `render` unconditionally replaces the editable input rather
than layering over it (check how the existing `"description"` column's `render` interacts with its
own `editable: canEdit` above), adjust this step to match whatever `EditableTreeTable` actually
supports (e.g. it may need the suggestion row placed in a separate non-editable column instead).
Confirm `BoqItemDto` already has a `suggestedHsnCode: string | null` field
(`packages/types/src/boq.ts`) before assuming it — it does today (used by `aiSuggestedHsnCode`
plumbing already in place for GST/HSN enrichment), but verify the exact field name.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bmp/web exec tsc --noEmit`
Expected: no output. (Stop the dev server first if it's running, per this repo's documented
typecheck/dev-server race gotcha.)

- [ ] **Step 7: Lint**

Run: `pnpm --filter @bmp/web exec eslint src/hooks/use-reference-data.ts src/hooks/use-settings.ts "src/app/(dashboard)/settings/page.tsx" src/components/boq/boq-item-grid.tsx`
Expected: no errors.

- [ ] **Step 8: Manual browser check**

Start (or reuse) `pnpm dev`, sign in as `superadmin@bmp.local`, navigate to `/settings`. Confirm:
the HSN/SAC card shows the row counts imported in Task 5; "Refresh now" and "Upload file" both
work; every settings group renders with the correct control type (switch vs. text vs. number);
toggling `HSN_SAC_AUTO_REFRESH_ENABLED` persists (reload the page, confirm it stayed). Then sign in
as a non-SUPER_ADMIN, non-ADMIN seeded user (e.g. `tender.manager@bmp.local`) and confirm
`/settings` shows the "don't have access" message, not the page — and separately, that
`admin@bmp.local` also cannot see it (per the RBAC design in Task 3).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/hooks/use-reference-data.ts apps/web/src/hooks/use-settings.ts \
        "apps/web/src/app/(dashboard)/settings/page.tsx" \
        apps/web/src/components/boq/boq-item-grid.tsx
git commit -m "feat(settings): Settings page, HSN/SAC refresh controls, HSN suggestion Apply button"
```

---

### Task 11: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: `pnpm db:seed` to pick up the new permission keys**

Run: `pnpm exec dotenv -e .env -- pnpm --filter @bmp/database exec tsx prisma/seed.ts` (or
whatever the actual `pnpm db:seed` script resolves to — confirm with
`grep -n "\"db:seed\"" package.json` first and use that exact command).
Expected: seed completes without error; `SUPER_ADMIN` now has `settings:read`/`settings:manage` via
its wildcard (no explicit seed change needed there), and no other role gained them.

- [ ] **Step 2: Full server unit suite**

Run: `pnpm --filter @bmp/server exec vitest run --exclude "**/*.integration.spec.ts"`
Expected: all pass except the one pre-existing, unrelated `scoped-client.spec.ts` failure this
session's earlier work already identified (SavedView model count drift from separate in-flight
work) — no other failures.

- [ ] **Step 3: Integration suite**

Run (with `docker compose up -d postgres redis minio minio-init` already running):
```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/reference-data
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/boq
```
Expected: all pass.

- [ ] **Step 4: Typecheck every touched workspace**

```bash
pnpm --filter @bmp/types exec tsc --noEmit
pnpm --filter @bmp/database exec tsc --noEmit -p . 2>/dev/null || true
pnpm --filter @bmp/server exec tsc --noEmit -p .
pnpm --filter @bmp/web exec tsc --noEmit
```
Expected: no output from any (stop `next dev` first for the web check).

- [ ] **Step 5: Lint every touched file**

Run lint scoped to every file this plan created or modified (server, web, types — list them
explicitly by package, following the same pattern used throughout this plan's per-task lint
steps). Expected: no errors.

- [ ] **Step 6: Manually re-verify the original bug against real data**

With the Task 5 seed already applied, re-run BOQ enrichment for tender `1400014127` (trigger via
whatever path this repo uses to re-enrich an already-committed BOQ — check
`AI_ENRICHMENT_ENABLED`/the `ai-enrichment` queue for how `enrichBoq` gets invoked on demand, e.g.
re-uploading the same BOQ file, or a direct service call from a `tsx` one-off if no UI re-trigger
exists). Confirm all 35 pipe-fitting lines now show `suggestedHsnCode: "7307"`, and that
`hsnCode` on each remains whatever it was before (untouched) until an estimator clicks Apply.

- [ ] **Step 7: Report final state**

Summarize: tests passing/total, typecheck/lint clean, the tender-1400014127 verification result,
and explicitly restate the Task 9 scope note (2 of 18 settings are live-wired; the rest are
stored/editable/audited but still need each consumer migrated + a restart to take effect).
