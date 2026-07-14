# Unified Per-Business Folder Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the document-generation template path and the tender-document auto-import folder under one shared `~/BMP-Businesses/<businessCode>/{templates,tenders}` root, with a safe, dry-run-first script to migrate the 56 real tender folders currently under `~/BMP-Tenders`.

**Architecture:** One env var replaces two. The watcher and the tender-creation folder-provisioning code both gain a business-code path segment. The watcher's file-to-tender resolution becomes directly business-scoped (reading the code from the path) instead of searching every business. A standalone migration script (not part of the app's runtime) moves existing folders once, with `--dry-run` as the default mode.

**Tech Stack:** Node `fs/promises`, `chokidar`, Prisma, Vitest.

## Global Constraints

- One new env var, `BUSINESSES_ROOT_DIR` (default `~/BMP-Businesses`), replaces both `LOCAL_DOCS_ROOT_DIR` and `TEMPLATES_ROOT_DIR` everywhere they're referenced.
- Folder layout: `${BUSINESSES_ROOT_DIR}/<businessCode>/templates/undertaking.docx` and `${BUSINESSES_ROOT_DIR}/<businessCode>/tenders/<tenderFolder>/...`.
- **The migration script defaults to `--dry-run` (prints the plan, touches nothing) — `--execute` must be passed explicitly to perform real moves.** Never run `--execute` against the owner's real `~/BMP-Tenders` directory as part of an automated task loop — that is an explicit, separate, human-supervised step after all code tasks are reviewed and merged (see Task 6's Step 5 and the plan's closing note).
- A folder that can't be resolved to a known tender is reported, never silently skipped or deleted.
- Follow existing conventions exactly: `expandHome`/`tenderFolderName`/`documentTypeForFolder` signatures stay as-is except where explicitly changed below; new script goes in `packages/database/scripts/`, invoked via `tsx`, matching `seed.ts`'s existing convention.

---

## File Structure

**New files:**
- `packages/database/scripts/migrate-tender-folders.ts` — the one-time migration script.
- `packages/database/scripts/__tests__/migrate-tender-folders.spec.ts` — unit tests for its planning logic.

**Modified files:**
- `apps/server/src/config/env.ts` — replace `LOCAL_DOCS_ROOT_DIR`/`TEMPLATES_ROOT_DIR` with `BUSINESSES_ROOT_DIR`.
- `.env.example`, `docs/environment-variables.md` — same replacement, documented.
- `apps/server/src/modules/tenders/local-docs/folder-naming.ts` — `ensureTenderFolders` takes a `businessCode` param.
- `apps/server/src/modules/tenders/local-docs/__tests__/folder-naming.spec.ts` — updated for the new signature.
- `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts` — business-code-aware path resolution, direct business-scoped tender lookup, `depth: 5`.
- `apps/server/src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts` — updated for the new lookup path.
- `apps/server/src/modules/document-generation/document-generation.service.ts` — template path takes `businessCode`.
- `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` / `.integration.spec.ts` — updated for the new path.
- `apps/server/src/modules/tenders/tenders.repository.ts` — `tenderDocGenArgs` select gains `business.code`.
- `apps/server/src/modules/tenders/tenders.service.ts` — gains `businessesRepository` dependency, looks up the business code before calling `ensureTenderFolders`.
- `apps/server/src/modules/tenders/tenders.module.ts` — wires the new dependency.
- `packages/database/package.json` — new `migrate-tender-folders` script entry.

---

### Task 1: Env var consolidation

**Files:**
- Modify: `apps/server/src/config/env.ts`
- Modify: `.env.example`
- Modify: `docs/environment-variables.md`

**Interfaces:**
- Produces: `env.BUSINESSES_ROOT_DIR: string` (default `"~/BMP-Businesses"`), consumed by Tasks 2-5.

- [ ] **Step 1: Replace the env schema entries**

In `apps/server/src/config/env.ts`, change:
```ts
  LOCAL_DOCS_SYNC_ENABLED: booleanEnv("false"),
  LOCAL_DOCS_ROOT_DIR: z.string().default("~/BMP-Tenders"),
```
to:
```ts
  LOCAL_DOCS_SYNC_ENABLED: booleanEnv("false"),
  BUSINESSES_ROOT_DIR: z.string().default("~/BMP-Businesses"),
```

Then find and remove the separate `TEMPLATES_ROOT_DIR: z.string().default("~/BMP-Templates"),` line entirely (added by the document-generation feature) — `BUSINESSES_ROOT_DIR` replaces it too.

- [ ] **Step 2: Update `.env.example`**

Change:
```
LOCAL_DOCS_SYNC_ENABLED=false
LOCAL_DOCS_ROOT_DIR=~/BMP-Tenders

# --- Document generation templates (optional) --------------------------------
# Folder holding one fixed-name .docx template per document type (e.g.
# undertaking.docx). No upload UI — place the file directly. Must be a plain
# .docx, not .dotx.
TEMPLATES_ROOT_DIR=~/BMP-Templates
```
to:
```
LOCAL_DOCS_SYNC_ENABLED=false

# --- Per-business folders (optional) ------------------------------------------
# One root, one subfolder per business (keyed by Business.code), each holding
# templates/ (document-generation .docx templates, e.g. templates/undertaking.docx
# — must be a plain .docx, not .dotx) and tenders/ (the existing tender-document
# auto-import folders, opt-in via LOCAL_DOCS_SYNC_ENABLED above). No upload UI —
# place files directly.
BUSINESSES_ROOT_DIR=~/BMP-Businesses
```

- [ ] **Step 3: Update `docs/environment-variables.md`**

In the `## Server` table, replace the `LOCAL_DOCS_ROOT_DIR` row (there is no separate `TEMPLATES_ROOT_DIR` row to remove here — the document-generation feature's Task 2 only added it to `.env.example`, not this file, so just replace the one row) — change:
```markdown
| `TEMPLATES_ROOT_DIR` | No (default `~/BMP-Templates`) | No | Folder where document-generation templates live, one fixed-name file per document type (e.g. `undertaking.docx`). No upload UI — place the file directly. It must be a plain `.docx` (not `.dotx`): if you built it from a `.dotx` letterhead starter in Word, use File > Save As > Word Document before placing it here. |
```
to:
```markdown
| `BUSINESSES_ROOT_DIR` | No (default `~/BMP-Businesses`) | No | One root, one subfolder per business (keyed by `Business.code`): `<code>/templates/` (document-generation `.docx` templates — must be a plain `.docx`, not `.dotx`: if built from a `.dotx` letterhead starter in Word, use File > Save As > Word Document first) and `<code>/tenders/` (the tender-document auto-import folders, opt-in via `LOCAL_DOCS_SYNC_ENABLED`). No upload UI — place files directly. |
```

(If you can't find a `TEMPLATES_ROOT_DIR` row in this file, that's fine — it means it was only ever documented in `.env.example`; just make sure the `LOCAL_DOCS_ROOT_DIR` row is replaced by the `BUSINESSES_ROOT_DIR` row above.)

- [ ] **Step 4: Verify it typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: errors in `folder-naming.ts`, `docs-watcher.service.ts`, `document-generation.service.ts` (they still reference the now-removed env vars) — these are expected and fixed in Tasks 2-4, not this one. Confirm the *only* errors are "Property does not exist" / "Cannot find name" for `LOCAL_DOCS_ROOT_DIR`/`TEMPLATES_ROOT_DIR` in those specific files.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/config/env.ts .env.example docs/environment-variables.md
git commit -m "feat(server): consolidate LOCAL_DOCS_ROOT_DIR/TEMPLATES_ROOT_DIR into BUSINESSES_ROOT_DIR"
```

---

### Task 2: `folder-naming.ts` — business-scoped tender folder path

**Files:**
- Modify: `apps/server/src/modules/tenders/local-docs/folder-naming.ts`
- Modify: `apps/server/src/modules/tenders/local-docs/__tests__/folder-naming.spec.ts`

**Interfaces:**
- Consumes: `env.BUSINESSES_ROOT_DIR` (Task 1, not used directly by this file — callers pass the root in).
- Produces: `ensureTenderFolders(rootDir: string, businessCode: string, tender: TenderFolderInfo): Promise<void>` (signature change — `businessCode` inserted as the second parameter), consumed by Task 3 (`docs-watcher.service.ts`) and Task 5 (`tenders.service.ts`).

- [ ] **Step 1: Write the failing test**

In `apps/server/src/modules/tenders/local-docs/__tests__/folder-naming.spec.ts`, change the `ensureTenderFolders` describe block from:
```ts
describe("ensureTenderFolders", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "bmp-docs-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("creates the tender folder with a subfolder for every document type", async () => {
    await ensureTenderFolders(rootDir, { tenderNumber: "TND-1", title: "Road Works" });

    const tenderDir = path.join(rootDir, "TND-1 - Road Works");
    const subfolders = await readdir(tenderDir);
    expect(subfolders.sort()).toEqual(
      ["Addendum", "BOQ", "Corrigendum", "Drawings", "General", "NIT", "Technical Specs", "Tender Notice"].sort(),
    );
  });

  it("is idempotent when called again for the same tender", async () => {
    const tender = { tenderNumber: "TND-2", title: "Bridge Works" };
    await ensureTenderFolders(rootDir, tender);
    await expect(ensureTenderFolders(rootDir, tender)).resolves.not.toThrow();
  });
});
```
to:
```ts
describe("ensureTenderFolders", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "bmp-docs-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("creates the tender folder under <businessCode>/tenders/, with a subfolder for every document type", async () => {
    await ensureTenderFolders(rootDir, "ARCHIE", { tenderNumber: "TND-1", title: "Road Works" });

    const tenderDir = path.join(rootDir, "ARCHIE", "tenders", "TND-1 - Road Works");
    const subfolders = await readdir(tenderDir);
    expect(subfolders.sort()).toEqual(
      ["Addendum", "BOQ", "Corrigendum", "Drawings", "General", "NIT", "Technical Specs", "Tender Notice"].sort(),
    );
  });

  it("keeps different businesses' tender folders separate", async () => {
    await ensureTenderFolders(rootDir, "ARCHIE", { tenderNumber: "TND-3", title: "Shared Number" });
    await ensureTenderFolders(rootDir, "SAMSON", { tenderNumber: "TND-3", title: "Shared Number" });

    const archieDir = path.join(rootDir, "ARCHIE", "tenders", "TND-3 - Shared Number");
    const samsonDir = path.join(rootDir, "SAMSON", "tenders", "TND-3 - Shared Number");
    await expect(readdir(archieDir)).resolves.toHaveLength(8);
    await expect(readdir(samsonDir)).resolves.toHaveLength(8);
  });

  it("is idempotent when called again for the same tender", async () => {
    const tender = { tenderNumber: "TND-2", title: "Bridge Works" };
    await ensureTenderFolders(rootDir, "ARCHIE", tender);
    await expect(ensureTenderFolders(rootDir, "ARCHIE", tender)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- tenders/local-docs/__tests__/folder-naming.spec.ts
```

Expected: FAIL — `ensureTenderFolders` is called with 3 args but only accepts 2 (or the resulting path doesn't include the business code segment, depending on how TypeScript/Vitest reports it).

- [ ] **Step 3: Update the implementation**

In `apps/server/src/modules/tenders/local-docs/folder-naming.ts`, change:
```ts
export async function ensureTenderFolders(rootDir: string, tender: TenderFolderInfo): Promise<void> {
  const tenderDir = path.join(expandHome(rootDir), tenderFolderName(tender));
  await Promise.all(
    Object.values(TENDER_DOCUMENT_TYPE_FOLDER_NAMES).map((folder) =>
      mkdir(path.join(tenderDir, folder), { recursive: true }),
    ),
  );
}
```
to:
```ts
export async function ensureTenderFolders(
  rootDir: string,
  businessCode: string,
  tender: TenderFolderInfo,
): Promise<void> {
  const tenderDir = path.join(expandHome(rootDir), businessCode, "tenders", tenderFolderName(tender));
  await Promise.all(
    Object.values(TENDER_DOCUMENT_TYPE_FOLDER_NAMES).map((folder) =>
      mkdir(path.join(tenderDir, folder), { recursive: true }),
    ),
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- tenders/local-docs/__tests__/folder-naming.spec.ts
```

Expected: PASS, all cases green (including the new "keeps different businesses' tender folders separate" case).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/tenders/local-docs/folder-naming.ts apps/server/src/modules/tenders/local-docs/__tests__/folder-naming.spec.ts
git commit -m "feat(tenders): scope ensureTenderFolders under <businessCode>/tenders/"
```

---

### Task 3: `docs-watcher.service.ts` — business-scoped folder sync and file resolution

**Files:**
- Modify: `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts`
- Modify: `apps/server/src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts`

**Interfaces:**
- Consumes: `ensureTenderFolders(rootDir, businessCode, tender)` (Task 2).
- Produces: `listAllTendersForFolderSync(): Promise<Array<TenderFolderInfo & { businessCode: string }>>` (return type changed — each entry now also carries `businessCode`), consumed only internally by `reconcileFolders` in this same file. `startLocalDocsWatcher` behavior changes (chokidar `depth: 5`, business-scoped `importFile`) but its exported signature is unchanged.

- [ ] **Step 1: Write the failing test**

Update `apps/server/src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts`'s `listAllTendersForFolderSync` describe block — change:
```ts
  describe("listAllTendersForFolderSync", () => {
    it("collects tenders from both businesses, not just one", async () => {
      const tenders = await listAllTendersForFolderSync();
      const tenderNumbers = tenders.map((tender) => tender.tenderNumber);

      expect(tenderNumbers).toContain(tenderANumber);
      expect(tenderNumbers).toContain(tenderBNumber);
    });
  });
```
to:
```ts
  describe("listAllTendersForFolderSync", () => {
    it("collects tenders from both businesses, not just one, each tagged with its business code", async () => {
      const tenders = await listAllTendersForFolderSync();
      const tenderA = tenders.find((tender) => tender.tenderNumber === tenderANumber);
      const tenderB = tenders.find((tender) => tender.tenderNumber === tenderBNumber);

      expect(tenderA?.businessCode).toBe(businessACode);
      expect(tenderB?.businessCode).toBe(businessBCode);
    });
  });
```

This requires two new variables, `businessACode`/`businessBCode`, captured from the businesses created in `beforeAll`. Change the `beforeAll` block's business-creation section from:
```ts
    const businessA = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business A ${randomUUID()}`,
        code: `DWA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business B ${randomUUID()}`,
        code: `DWB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;
```
to:
```ts
    const businessA = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business A ${randomUUID()}`,
        code: `DWA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Docs Watcher Business B ${randomUUID()}`,
        code: `DWB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;
    businessACode = businessA.code;
    businessBCode = businessB.code;
```

And add the two new `let` declarations alongside the existing ones at the top of the `describe` block — change:
```ts
  let userId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  let tenderAId: string;
  let tenderBId: string;
  let tenderANumber: string;
  let tenderBNumber: string;
```
to:
```ts
  let userId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  let businessACode: string;
  let businessBCode: string;
  let tenderAId: string;
  let tenderBId: string;
  let tenderANumber: string;
  let tenderBNumber: string;
```

Also update `findTenderByNumberAcrossBusinesses`'s existing tests in the same file — no code change needed there (that function's behavior/signature is unchanged, still used by the migration script in Task 6), just leave those three `it` blocks as they are.

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose up -d postgres redis minio minio-init mailhog
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts
```

Expected: FAIL — `tender.businessCode` is `undefined` (the function doesn't attach it yet).

- [ ] **Step 3: Update `listAllTendersForFolderSync` and `reconcileFolders`**

In `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts`, change:
```ts
export async function listAllTendersForFolderSync(): Promise<TenderFolderInfo[]> {
  const businessIds = await listAllBusinessIds(prisma);
  const tendersByBusiness = await Promise.all(
    businessIds.map((businessId) =>
      prisma.tender.findMany({ where: { businessId }, select: { tenderNumber: true, title: true } }),
    ),
  );
  return tendersByBusiness.flat();
}

async function reconcileFolders(rootDir: string): Promise<void> {
  const tenders = await listAllTendersForFolderSync();
  await Promise.all(tenders.map((tender) => ensureTenderFolders(rootDir, tender)));
  logger.info(`Local docs sync: reconciled folders for ${tenders.length} tender(s) under ${rootDir}`);
}
```
to:
```ts
export async function listAllTendersForFolderSync(): Promise<
  Array<TenderFolderInfo & { businessCode: string }>
> {
  const businesses = await prisma.business.findMany({ select: { id: true, code: true } });
  const tendersByBusiness = await Promise.all(
    businesses.map(async (business) => {
      const tenders = await prisma.tender.findMany({
        where: { businessId: business.id },
        select: { tenderNumber: true, title: true },
      });
      return tenders.map((tender) => ({ ...tender, businessCode: business.code }));
    }),
  );
  return tendersByBusiness.flat();
}

async function reconcileFolders(rootDir: string): Promise<void> {
  const tenders = await listAllTendersForFolderSync();
  await Promise.all(tenders.map((tender) => ensureTenderFolders(rootDir, tender.businessCode, tender)));
  logger.info(`Local docs sync: reconciled folders for ${tenders.length} tender(s) under ${rootDir}`);
}
```

Note this inlines the same `listAllBusinessIds`-style loop but fetches `code` alongside `id` in one query instead of two — remove the now-unused `listAllBusinessIds` import from this file's import list if `findTenderByNumberAcrossBusinesses` (below) is also being changed to no longer need it; check Step 4 before removing the import.

- [ ] **Step 4: Update `importFile`'s path resolution to be business-scoped**

In the same file, change:
```ts
async function importFile(rootDir: string, absolutePath: string): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // A file dropped directly at the watch root, outside any tender folder,
  // has nothing to resolve against — nothing to do.
  if (segments.length < 2) return;

  const [tenderFolder, subfolder] = segments;
  const tenderNumber = tenderNumberFromFolderName(tenderFolder!);
  if (!tenderNumber) return;

  const tender = await findTenderByNumberAcrossBusinesses(tenderNumber);
  if (!tender) {
    logger.warn(`Local docs sync: no tender matches folder "${tenderFolder}" — skipping ${relative}`);
    return;
  }

  const documentType = documentTypeForFolder(segments.length > 2 ? subfolder : undefined);
```
to:
```ts
async function importFile(rootDir: string, absolutePath: string): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // A file dropped outside <businessCode>/tenders/<tenderFolder>/ has nothing
  // to resolve against — nothing to do. Minimum shape: [businessCode, "tenders",
  // tenderFolder, filename] = 4 segments.
  if (segments.length < 4) return;

  const [businessCode, tendersSegment, tenderFolder, subfolder] = segments;
  if (tendersSegment !== "tenders") return;

  const business = await prisma.business.findUnique({
    where: { code: businessCode! },
    select: { id: true },
  });
  if (!business) {
    logger.warn(`Local docs sync: no business matches folder "${businessCode}" — skipping ${relative}`);
    return;
  }

  const tenderNumber = tenderNumberFromFolderName(tenderFolder!);
  if (!tenderNumber) return;

  const tender = await prisma.tender.findFirst({
    where: { tenderNumber, businessId: business.id },
    select: { id: true },
  });
  if (!tender) {
    logger.warn(
      `Local docs sync: no tender matches folder "${tenderFolder}" under business "${businessCode}" — skipping ${relative}`,
    );
    return;
  }

  const documentType = documentTypeForFolder(segments.length > 4 ? subfolder : undefined);
```

Since `importFile` no longer calls `findTenderByNumberAcrossBusinesses`, remove that call site — but **keep the `findTenderByNumberAcrossBusinesses` function itself and its export** (do not delete it): Task 6's migration script uses it directly (the old, pre-migration folders genuinely carry no business segment, so the cross-business search is exactly right there). Since it's no longer called from within this file after this change, its only remaining caller will be the migration script (a different file) and its own existing integration test — both of which import it directly from this module, so no import changes needed inside `docs-watcher.service.ts` itself for that function, only for `listAllBusinessIds` if it's no longer used anywhere in this file (check: `findTenderByNumberAcrossBusinesses`'s own implementation still uses `listAllBusinessIds`, so the import stays — do not remove it).

- [ ] **Step 5: Update the chokidar watch depth**

In the same file's `startLocalDocsWatcher`, change:
```ts
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 3,
  });
```
to:
```ts
  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 5,
  });
```

(Two more path segments — `<businessCode>/tenders/` — now sit above what used to be the root, so the same relative watch depth needs to reach two levels deeper.)

- [ ] **Step 6: Run it to verify it passes**

```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts
```

Expected: PASS, all cases green (including the updated `listAllTendersForFolderSync` case and the unchanged `findTenderByNumberAcrossBusinesses` cases).

- [ ] **Step 7: Verify the whole server package typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0 (this should clear the `LOCAL_DOCS_ROOT_DIR` errors from Task 1's Step 4 for this file, since `docs-watcher.service.ts` never referenced that env var directly — it receives `rootDir` as a parameter from `worker.ts`, which Task 1 already updated to pass `env.BUSINESSES_ROOT_DIR`).

Wait — check `apps/server/src/worker.ts`: it currently has `startLocalDocsWatcher(env.LOCAL_DOCS_ROOT_DIR)`. Since Task 1 removed `LOCAL_DOCS_ROOT_DIR` from `env.ts`, this line now fails to typecheck. Fix it as part of this task (it's the caller of the function this task modifies): change `apps/server/src/worker.ts`'s line
```ts
  ? await startLocalDocsWatcher(env.LOCAL_DOCS_ROOT_DIR)
```
to:
```ts
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts apps/server/src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts apps/server/src/worker.ts
git commit -m "feat(tenders): resolve local-docs file imports by business-code path segment"
```

---

### Task 4: Document generation — business-scoped template path

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts`
- Modify: `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts`
- Modify: `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`

**Interfaces:**
- Produces: `getTemplatePath(businessCode: string, documentType: DocumentType): string`, `getTemplateStatus(businessCode: string, documentType: DocumentType): Promise<TemplateStatus>` (both gain a leading `businessCode` param), consumed by `generateUndertaking` in the same file (already calls both internally — no external consumers beyond this file's own tests).
- Produces: `TenderForDocumentGeneration.business.code: string` (new field on the existing type), consumed by `generateUndertaking`.

- [ ] **Step 1: Add `code` to the tenders repository's doc-gen query**

In `apps/server/src/modules/tenders/tenders.repository.ts`, change:
```ts
const tenderDocGenArgs = {
  include: {
    business: { select: { name: true, address: true, gstNumber: true, panNumber: true } },
    client: { select: { name: true, address: true } },
  },
} satisfies Prisma.TenderDefaultArgs;
```
to:
```ts
const tenderDocGenArgs = {
  include: {
    business: { select: { code: true, name: true, address: true, gstNumber: true, panNumber: true } },
    client: { select: { name: true, address: true } },
  },
} satisfies Prisma.TenderDefaultArgs;
```

- [ ] **Step 2: Write the failing unit tests**

In `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts`:

Update the `getTemplateStatus` describe block's two tests to pass a business code as the first argument — change both calls from `getTemplateStatus("undertaking")` to `getTemplateStatus("ARCHIE", "undertaking")`, and change the path assertions to expect the business code as a path segment. The full updated block:
```ts
describe("getTemplateStatus", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports exists: false when the template file is absent", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { BUSINESSES_ROOT_DIR: string }).BUSINESSES_ROOT_DIR = tempDir;
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("ARCHIE", "undertaking");

    expect(status.exists).toBe(false);
    expect(status.lastModifiedAt).toBeNull();
    expect(status.filename).toBe("undertaking.docx");
    expect(status.path).toBe(path.join(tempDir, "ARCHIE", "templates", "undertaking.docx"));
  });

  it("reports exists: true with the file's mtime when present", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { BUSINESSES_ROOT_DIR: string }).BUSINESSES_ROOT_DIR = tempDir;
    await mkdir(path.join(tempDir, "ARCHIE", "templates"), { recursive: true });
    await writeFile(path.join(tempDir, "ARCHIE", "templates", "undertaking.docx"), "fake docx bytes");
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("ARCHIE", "undertaking");

    expect(status.exists).toBe(true);
    expect(status.lastModifiedAt).not.toBeNull();
    expect(new Date(status.lastModifiedAt!).getTime()).not.toBeNaN();
  });
});
```
(This uses `mkdir` — check the file's existing imports at the top; `mkdir` is likely already imported from `node:fs/promises` for the `generateUndertaking` tests further down. Add it to that existing import if not already present, do not add a second import statement.)

Also update the mock at the top of the file from:
```ts
vi.mock("../../../config/env.js", () => ({ env: { TEMPLATES_ROOT_DIR: "" } }));
```
to:
```ts
vi.mock("../../../config/env.js", () => ({ env: { BUSINESSES_ROOT_DIR: "" } }));
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: FAIL — `getTemplateStatus` still only accepts one argument, or the resolved path doesn't include the business code / `templates` segment.

- [ ] **Step 4: Update `getTemplatePath`/`getTemplateStatus`**

In `apps/server/src/modules/document-generation/document-generation.service.ts`, change:
```ts
export function getTemplatePath(documentType: DocumentType): string {
  return path.join(expandHome(env.TEMPLATES_ROOT_DIR), TEMPLATE_FILENAMES[documentType]);
}

export async function getTemplateStatus(documentType: DocumentType): Promise<TemplateStatus> {
  const templatePath = getTemplatePath(documentType);
```
to:
```ts
export function getTemplatePath(businessCode: string, documentType: DocumentType): string {
  return path.join(
    expandHome(env.BUSINESSES_ROOT_DIR),
    businessCode,
    "templates",
    TEMPLATE_FILENAMES[documentType],
  );
}

export async function getTemplateStatus(
  businessCode: string,
  documentType: DocumentType,
): Promise<TemplateStatus> {
  const templatePath = getTemplatePath(businessCode, documentType);
```

- [ ] **Step 5: Update `generateUndertaking`'s two internal calls**

In the same file, change:
```ts
  const status = await getTemplateStatus("undertaking");
```
to:
```ts
  const status = await getTemplateStatus(tender.business.code, "undertaking");
```

Also update the error message to name the business — change:
```ts
    throw new NotFoundError(`Undertaking template not found. Place it at ${status.path}`);
```
to:
```ts
    throw new NotFoundError(
      `Undertaking template not found for ${tender.business.code}. Place it at ${status.path}`,
    );
```

- [ ] **Step 6: Update `generateUndertaking`'s own tests for the new template lookup**

In `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts`'s `generateUndertaking` describe block, every test's `writeFile`/`mkdir` calls that build the template path need the `<businessCode>/templates/` segments, and every fake tender fixture's `business` object needs a `code` field. For example, change:
```ts
  it("fills the template with the tender's data and returns a docx buffer", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      path.join(tempDir, "undertaking.docx"),
      buildTestDocxBuffer(
        "Dear {{clientOrganizationName}}, re: {{tenderNumber}} - {{tenderTitle}}, from {{businessName}} (GST {{businessGstNumber}}).",
      ),
    );

    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        department: "PWD",
        business: { name: "Archie Udyog", address: null, gstNumber: "27AAAAA0000A1Z5", panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
```
to:
```ts
  it("fills the template with the tender's data and returns a docx buffer", async () => {
    const templatesDir = path.join(tempDir, "ARCHIE", "templates");
    await mkdir(templatesDir, { recursive: true });
    await writeFile(
      path.join(templatesDir, "undertaking.docx"),
      buildTestDocxBuffer(
        "Dear {{clientOrganizationName}}, re: {{tenderNumber}} - {{tenderTitle}}, from {{businessName}} (GST {{businessGstNumber}}).",
      ),
    );

    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        department: "PWD",
        business: {
          code: "ARCHIE",
          name: "Archie Udyog",
          address: null,
          gstNumber: "27AAAAA0000A1Z5",
          panNumber: null,
        },
        client: { name: "Acme Corp", address: null },
      }),
    };
```

Apply the same two changes (path gains `ARCHIE/templates/`, fake `business` object gains `code: "ARCHIE"`) to the other two `generateUndertaking` tests in this file ("throws NotFoundError when the tender doesn't exist" and "throws a clear error when the template file is missing") — the second of those two doesn't write a template file at all (that's the point of the test), so it only needs the `business.code` field added to its fake tender fixture, no path change.

- [ ] **Step 7: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: PASS, all 7 cases green.

- [ ] **Step 8: Update the integration test**

In `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`:

Change the `beforeAll`/`afterAll` env var name from `TEMPLATES_ROOT_DIR` to `BUSINESSES_ROOT_DIR` — update:
```ts
  const originalTemplatesRootDir = process.env.TEMPLATES_ROOT_DIR;

  beforeAll(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-integration-"));
    process.env.TEMPLATES_ROOT_DIR = templatesDir;
  });

  afterAll(async () => {
    await rm(templatesDir, { recursive: true, force: true });
    if (originalTemplatesRootDir) process.env.TEMPLATES_ROOT_DIR = originalTemplatesRootDir;
  });
```
to:
```ts
  const originalBusinessesRootDir = process.env.BUSINESSES_ROOT_DIR;

  beforeAll(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-integration-"));
    process.env.BUSINESSES_ROOT_DIR = templatesDir;
  });

  afterAll(async () => {
    await rm(templatesDir, { recursive: true, force: true });
    if (originalBusinessesRootDir) process.env.BUSINESSES_ROOT_DIR = originalBusinessesRootDir;
  });
```

Then, everywhere the test writes `undertaking.docx` directly under `templatesDir`, insert the business's code + `templates` segment instead. The test's `beforeEach` already creates a real `Business` row via `createIntegrationTestUser` — find where that user's business code is available (check `IntegrationTestUser`'s shape in `apps/server/src/shared/test-utils/integration-auth.ts` — it returns `businessId` but not the business's `code` string; you'll need to either fetch it via `prisma.business.findUnique({ where: { id: testUser.businessId }, select: { code: true } })` once in `beforeEach` and store it in a `businessCode` variable, or add `code` to what `createIntegrationTestUser` returns if that's simpler — prefer fetching it locally in this test file over modifying the shared test helper, since no other test needs this yet). Use that `businessCode` to build `path.join(templatesDir, businessCode, "templates", "undertaking.docx")` wherever the test currently does `path.join(templatesDir, "undertaking.docx")` (both in the happy-path test's `writeFile` call and the cross-tenant test's `writeFile` call).

- [ ] **Step 9: Run the integration test**

```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/document-generation/__tests__/document-generation.integration.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 10: Verify the whole server package typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/modules/document-generation/document-generation.service.ts apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts apps/server/src/modules/tenders/tenders.repository.ts
git commit -m "feat(document-generation): scope template lookup under <businessCode>/templates/"
```

---

### Task 5: Tender creation — pass the business code through

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.service.ts`
- Modify: `apps/server/src/modules/tenders/tenders.module.ts`

**Interfaces:**
- Consumes: `IBusinessesRepository.findById(id: string): Promise<BusinessWithContacts | null>` (existing, from `apps/server/src/modules/businesses/businesses.repository.ts` — `BusinessWithContacts` already includes `code`), `ensureTenderFolders(rootDir, businessCode, tender)` (Task 2).
- Produces: `TendersService`'s constructor gains a new required parameter (see Step 1) — this is a breaking change to its constructor signature, so `tenders.module.ts` (the only place it's instantiated) must be updated in the same task.

- [ ] **Step 1: Add `businessesRepository` to `TendersService`**

In `apps/server/src/modules/tenders/tenders.service.ts`, add the import:
```ts
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";
```

Change the constructor from:
```ts
  constructor(
    private readonly tendersRepository: ITendersRepository,
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly usersRepository: IUsersRepository,
    private readonly tagsRepository: ITagsRepository,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}
```
to:
```ts
  constructor(
    private readonly tendersRepository: ITendersRepository,
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly usersRepository: IUsersRepository,
    private readonly tagsRepository: ITagsRepository,
    private readonly businessesRepository: IBusinessesRepository,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}
```

- [ ] **Step 2: Look up the business code before calling `ensureTenderFolders`**

In the same file's `create` method, change:
```ts
    if (env.LOCAL_DOCS_SYNC_ENABLED) {
      void ensureTenderFolders(env.LOCAL_DOCS_ROOT_DIR, tender).catch((error: unknown) => {
```
to:
```ts
    if (env.LOCAL_DOCS_SYNC_ENABLED) {
      void this.businessesRepository.findById(context.businessId).then((business) => {
        if (!business) return;
        return ensureTenderFolders(env.BUSINESSES_ROOT_DIR, business.code, tender);
      }).catch((error: unknown) => {
```

(Keep the rest of that `.catch` block's existing error-logging body exactly as it already is — only the lines shown above change; check the existing code immediately after this line for the exact closing of the `.catch(...)` call and preserve it unmodified.)

- [ ] **Step 3: Wire the new dependency in `tenders.module.ts`**

In `apps/server/src/modules/tenders/tenders.module.ts`, add the import:
```ts
import { businessesRepository } from "../businesses/businesses.module.js";
```

Change:
```ts
export const tendersService = new TendersService(
  tendersRepository,
  organizationsRepository,
  usersRepository,
  tagsRepository,
  auditService,
  attachmentsService,
  notificationsService,
  emailService,
);
```
to:
```ts
export const tendersService = new TendersService(
  tendersRepository,
  organizationsRepository,
  usersRepository,
  tagsRepository,
  businessesRepository,
  auditService,
  attachmentsService,
  notificationsService,
  emailService,
);
```

- [ ] **Step 4: Check for existing `TendersService` unit tests that construct it directly**

Search for other call sites: `grep -rn "new TendersService(" apps/server/src`. If `apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts` (or similar) constructs `TendersService` directly with a fake-repository argument list, add a minimal fake `businessesRepository` (e.g. `{ findById: vi.fn().mockResolvedValue({ code: "TEST", ... }) } as unknown as IBusinessesRepository`, or a hand-written fake matching this test file's existing convention for its other fake repositories) in the correct constructor position (5th argument, after `tagsRepository`, before `auditService`).

- [ ] **Step 5: Verify everything typechecks and existing tender tests still pass**

```bash
pnpm --filter @bmp/server typecheck
pnpm --filter @bmp/server test -- tenders/__tests__/tenders.service.spec.ts
```

Expected: both exit clean / all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/tenders/tenders.service.ts apps/server/src/modules/tenders/tenders.module.ts apps/server/src/modules/tenders/__tests__/tenders.service.spec.ts
git commit -m "feat(tenders): pass the owning business's code into ensureTenderFolders on create"
```

---

### Task 6: Migration script for the 56 existing tender folders

**Files:**
- Create: `packages/database/scripts/migrate-tender-folders.ts`
- Create: `packages/database/scripts/__tests__/migrate-tender-folders.spec.ts`
- Modify: `packages/database/package.json`

**Interfaces:**
- Consumes: `findTenderByNumberAcrossBusinesses` (existing, unchanged, from `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts` — this script imports it directly), `expandHome`/`tenderNumberFromFolderName` (existing, unchanged, from `apps/server/src/modules/tenders/local-docs/folder-naming.ts`).
- Produces: `planMigration(oldRootDir: string): Promise<MigrationPlan>` (pure planning logic, no filesystem writes — this is what Step 1-4's unit test exercises), `executeMigration(plan: MigrationPlan): Promise<void>` (performs the real moves), and a CLI entry point that parses `--execute`/defaults to dry-run.

**This task produces code and tests only, against synthetic temp directories. It does NOT run against the real `~/BMP-Tenders` directory — that is a separate, manual, human-supervised step after this task (and the whole plan) is reviewed and merged. Do not add a step that runs this script with `--execute` against any real path.**

- [ ] **Step 1: Write the failing test for the planning logic**

Create `packages/database/scripts/__tests__/migrate-tender-folders.spec.ts`:
```ts
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js", () => ({
  findTenderByNumberAcrossBusinesses: vi.fn(),
}));

describe("planMigration", () => {
  let oldRootDir: string;

  beforeEach(async () => {
    oldRootDir = await mkdtemp(path.join(tmpdir(), "bmp-migrate-test-"));
  });

  afterEach(async () => {
    await rm(oldRootDir, { recursive: true, force: true });
  });

  it("plans a move for each folder that resolves to a tender, grouped by business code", async () => {
    await mkdir(path.join(oldRootDir, "TND-1 - Road Works"), { recursive: true });
    await mkdir(path.join(oldRootDir, "TND-2 - Bridge Works"), { recursive: true });

    const { findTenderByNumberAcrossBusinesses } = await import(
      "../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js"
    );
    vi.mocked(findTenderByNumberAcrossBusinesses).mockImplementation(async (tenderNumber: string) => {
      if (tenderNumber === "TND-1") return { id: "tender-1", businessCode: "ARCHIE" } as never;
      if (tenderNumber === "TND-2") return { id: "tender-2", businessCode: "SAMSON" } as never;
      return null;
    });

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        {
          from: path.join(oldRootDir, "TND-1 - Road Works"),
          to: expect.stringContaining(path.join("ARCHIE", "tenders", "TND-1 - Road Works")),
        },
        {
          from: path.join(oldRootDir, "TND-2 - Bridge Works"),
          to: expect.stringContaining(path.join("SAMSON", "tenders", "TND-2 - Bridge Works")),
        },
      ]),
    );
    expect(plan.unresolved).toEqual([]);
  });

  it("reports a folder that doesn't resolve to any tender as unresolved, without planning a move for it", async () => {
    await mkdir(path.join(oldRootDir, "TND-UNKNOWN - Mystery"), { recursive: true });

    const { findTenderByNumberAcrossBusinesses } = await import(
      "../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js"
    );
    vi.mocked(findTenderByNumberAcrossBusinesses).mockResolvedValue(null);

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual(["TND-UNKNOWN - Mystery"]);
  });

  it("ignores non-directory entries at the root (e.g. stray files like .DS_Store)", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(oldRootDir, ".DS_Store"), "");

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @bmp/database test -- __tests__/migrate-tender-folders.spec.ts
```

Expected: FAIL — `Cannot find module '../migrate-tender-folders.js'`. (If `pnpm --filter @bmp/database test` reports `"no tests" && exit 0` unconditionally per its current `package.json` script, run vitest directly instead: `pnpm --filter @bmp/database exec vitest run scripts/__tests__/migrate-tender-folders.spec.ts` — check `packages/database/package.json`'s current `"test"` script value first, and use whichever actually invokes vitest.)

- [ ] **Step 3: Implement the planning logic**

Create `packages/database/scripts/migrate-tender-folders.ts`:
```ts
import { readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";

import {
  findTenderByNumberAcrossBusinesses,
} from "../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js";
import { tenderNumberFromFolderName } from "../../../apps/server/src/modules/tenders/local-docs/folder-naming.js";

export interface MigrationPlan {
  moves: Array<{ from: string; to: string }>;
  unresolved: string[];
}

export async function planMigration(oldRootDir: string, newRootDir: string = oldRootDir): Promise<MigrationPlan> {
  const entries = await readdir(oldRootDir, { withFileTypes: true });
  const moves: MigrationPlan["moves"] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const tenderNumber = tenderNumberFromFolderName(entry.name);
    if (!tenderNumber) {
      unresolved.push(entry.name);
      continue;
    }

    const match = await findTenderByNumberAcrossBusinesses(tenderNumber);
    const businessCode = (match as { businessCode?: string } | null)?.businessCode;
    if (!match || !businessCode) {
      unresolved.push(entry.name);
      continue;
    }

    moves.push({
      from: path.join(oldRootDir, entry.name),
      to: path.join(newRootDir, businessCode, "tenders", entry.name),
    });
  }

  return { moves, unresolved };
}

export async function executeMigration(plan: MigrationPlan, oldRootDir: string): Promise<void> {
  for (const move of plan.moves) {
    await rename(move.from, move.to);
  }
  const remaining = await readdir(oldRootDir);
  if (remaining.length === 0) {
    await rmdir(oldRootDir);
  }
}

function printPlan(plan: MigrationPlan): void {
  console.log(`Planned moves (${plan.moves.length}):`);
  for (const move of plan.moves) {
    console.log(`  ${move.from}\n    -> ${move.to}`);
  }
  if (plan.unresolved.length > 0) {
    console.log(`\nUnresolved (${plan.unresolved.length}) — left in place, not moved:`);
    for (const name of plan.unresolved) {
      console.log(`  ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const { env } = await import("../../../apps/server/src/config/env.js");
  const { expandHome } = await import("../../../apps/server/src/modules/tenders/local-docs/folder-naming.js");

  const oldRootDir = expandHome("~/BMP-Tenders");
  const newRootDir = expandHome(env.BUSINESSES_ROOT_DIR);
  const shouldExecute = process.argv.includes("--execute");

  const plan = await planMigration(oldRootDir, newRootDir);
  printPlan(plan);

  if (!shouldExecute) {
    console.log("\nDry run only — nothing was moved. Re-run with --execute to perform these moves for real.");
    return;
  }

  console.log("\nExecuting...");
  await executeMigration(plan, oldRootDir);
  console.log("Done.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter @bmp/database exec vitest run scripts/__tests__/migrate-tender-folders.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 5: Add the script command (for later, manual, human-supervised use — do not run `--execute` now)**

In `packages/database/package.json`'s `"scripts"`, add:
```json
    "migrate-tender-folders": "tsx scripts/migrate-tender-folders.ts",
```

Verify the dry-run mode works end-to-end against a **throwaway synthetic directory** (never the real `~/BMP-Tenders`) as a smoke check:
```bash
mkdir -p /tmp/bmp-migrate-smoketest/TND-SMOKE-1 - Smoke Test
pnpm exec dotenv -e .env -- pnpm --filter @bmp/database migrate-tender-folders
```
Expected: prints a plan (likely reporting `TND-SMOKE-1 - Smoke Test` as unresolved, since no real tender with that number exists) and exits without moving or deleting anything. Clean up the throwaway directory afterward: `rm -rf /tmp/bmp-migrate-smoketest`.

- [ ] **Step 6: Verify the whole database package typechecks**

```bash
pnpm --filter @bmp/database typecheck
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/database/scripts/migrate-tender-folders.ts packages/database/scripts/__tests__/migrate-tender-folders.spec.ts packages/database/package.json
git commit -m "feat(database): add dry-run-first migration script for existing tender folders"
```

---

## Self-Review Notes

- **Spec coverage:** env consolidation (Task 1), business-scoped tender folder creation (Tasks 2, 5), business-scoped watcher resolution + increased chokidar depth (Task 3), business-scoped template path (Task 4), dry-run-first migration script (Task 6) — all covered. The spec's "direct business-scoped lookup replaces cross-business search" goal is implemented in Task 3 Step 4; `findTenderByNumberAcrossBusinesses` is deliberately kept (not deleted) since Task 6's migration script still needs it for the old, business-agnostic folder names.
- **Type consistency:** `businessCode: string` flows as an added parameter through `ensureTenderFolders` (Task 2) → its two callers (Task 3's `reconcileFolders`, Task 5's `tenders.service.ts`) and through `getTemplatePath`/`getTemplateStatus` (Task 4) → `generateUndertaking`'s existing internal calls, sourced everywhere from either `Business.code` (a real Prisma field, confirmed to exist and be a plain `String` on the schema) or a test double shaped to match.
- **No placeholders:** every step has complete, runnable code. Task 6's `main()` intentionally never receives an automated `--execute` step in this plan — that omission is deliberate (see Global Constraints), not a gap.
- **Real-data safety:** no task in this plan runs `migrate-tender-folders.ts --execute` against `~/BMP-Tenders`. After all 6 tasks are done, reviewed, and merged, the actual real-data migration is a separate manual step: run `pnpm --filter @bmp/database migrate-tender-folders` (dry-run) against the real environment, review the printed plan with the owner, and only then re-run with `--execute` once they've explicitly confirmed it.
