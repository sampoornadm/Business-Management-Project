# Incoming Tenders Folder Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop a tender PDF/DOCX into `${BUSINESSES_ROOT_DIR}/<businessCode>/incoming-tenders/` and have it fully absorbed — tender created (DRAFT), client resolved/auto-created, BOQ items committed (no rate), source document attached — using only already-shipped extraction/creation logic.

**Architecture:** A new chokidar watcher (sibling to the existing `docs-watcher.service.ts`, same watched root, different subfolder) reuses `TenderExtractionService` (deterministic SAIL/IISCO parser, unchanged), `tendersService.create()` (unchanged), `boqService.commitBoq()` (unchanged), and `ensureTenderFolders`/the existing per-tender attachment watcher (unchanged) to run the pipeline already proven by hand this session. Only new code is the orchestration itself: a pure field-mapping function (Task 1) and the watcher/orchestration (Task 2).

**Tech Stack:** chokidar (already a dependency), Vitest, real Postgres for integration tests (matching `docs-watcher.service.integration.spec.ts`'s convention).

## Global Constraints

- Watched path: `${BUSINESSES_ROOT_DIR}/<businessCode>/incoming-tenders/` — a sibling of the existing `templates/`/`tenders/` per-business subfolders, same root.
- **Never guess a value for `tenderNumber` or `submissionDate`** — if either is missing from extraction, leave the file in place, log a warning, stop. These are the two fields where a wrong guess is worse than no automation (a mis-numbered tender collides with a real one; a wrong deadline silently misses the real one).
- Every other required-but-unextracted field (`title`, `department`, `type`, `category`, `location`, `state`, `estimatedCost`) gets an explicit placeholder value, and the tender's `remarks` field lists exactly which ones were placeholdered — never silently blend a placeholder in without saying so.
- A `tenderNumber` that already exists (the existing `tendersService.create()` throws `ConflictError`) → move the file to `incoming-tenders/duplicates/`, log, stop. Never overwrite or silently drop.
- BOQ items are committed with `description`/`unit`/`quantity`/`itemCode` only — never a `rate` (no prices exist at RFQ stage).
- No changes to `TenderExtractionService`, `tendersService.create()`, `boqService.commitBoq()`, `ensureTenderFolders`, or the existing per-tender `docs-watcher.service.ts` attachment watcher — every one of these is reused exactly as it already ships.

---

### Task 1: Field-mapping — extraction result to draft tender data

**Files:**
- Create: `apps/server/src/modules/tenders/local-docs/incoming-tender-mapper.ts`
- Create: `apps/server/src/modules/tenders/local-docs/__tests__/incoming-tender-mapper.spec.ts`
- Modify: `apps/server/src/modules/tenders/tenders.module.ts` (export `tenderExtractionService`)
- Modify: `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts` (export `getSystemUserId`)

**Interfaces:**
- Consumes: `TenderExtractionFields` (existing, from `@bmp/types` — see plan's Global Constraints for exact optional/required shape), `CreateTenderData` (existing, from `apps/server/src/modules/tenders/tenders.repository.ts`).
- Produces: `buildDraftTenderData(fields: TenderExtractionFields, businessId: string, createdById: string): Omit<CreateTenderData, "clientId"> | null` (returns `null` when `tenderNumber` or `submissionDate` is missing — the caller in Task 2 treats `null` as "leave file in place, don't process"), consumed by Task 2's `processIncomingTenderFile`.
- Produces: `tenderExtractionService` now exported from `tenders.module.ts` (was previously module-private), consumed by Task 2.
- Produces: `getSystemUserId` now exported from `docs-watcher.service.ts` (was previously module-private), consumed by Task 2.

- [ ] **Step 1: Export the two existing module-private values**

In `apps/server/src/modules/tenders/tenders.module.ts`, change:
```ts
const tenderExtractionService = new TenderExtractionService(
  organizationsRepository,
  generateJson,
  extractDocumentText,
);
```
to:
```ts
export const tenderExtractionService = new TenderExtractionService(
  organizationsRepository,
  generateJson,
  extractDocumentText,
);
```

In `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts`, change:
```ts
async function getSystemUserId(): Promise<string> {
```
to:
```ts
export async function getSystemUserId(): Promise<string> {
```

- [ ] **Step 2: Write the failing test**

Create `apps/server/src/modules/tenders/local-docs/__tests__/incoming-tender-mapper.spec.ts`:
```ts
import { describe, expect, it } from "vitest";

import type { TenderExtractionFields } from "@bmp/types";

import { buildDraftTenderData } from "../incoming-tender-mapper.js";

const BUSINESS_ID = "business-1";
const CREATED_BY_ID = "system-user-1";

describe("buildDraftTenderData", () => {
  it("returns null when tenderNumber is missing", () => {
    const fields: TenderExtractionFields = { submissionDate: "2026-07-20" };
    expect(buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID)).toBeNull();
  });

  it("returns null when submissionDate is missing", () => {
    const fields: TenderExtractionFields = { tenderNumber: "1400013728" };
    expect(buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID)).toBeNull();
  });

  it("maps every extracted field through unchanged when all are present", () => {
    const fields: TenderExtractionFields = {
      tenderNumber: "1400013728",
      title: "MJ/C04/2026/3699-SLEEVE",
      department: "ISP MATERIAL MANAGEMENT DEPARTMENT",
      type: "Two Part Bid Response",
      category: "Insulation Material",
      location: "Burnpur",
      state: "West Bengal",
      estimatedCost: 250000,
      emdAmount: 5000,
      tenderFee: 500,
      documentFee: 200,
      submissionDate: "2026-07-20T15:00:00",
      openingDate: "2026-07-13",
      validityPeriodDays: 90,
      description: "Procurement of SLEEVE,1MM,FIBER GLASS",
      remarks: "Some remark from the document",
      dealingOfficerName: "Namasri Banerjee",
      dealingOfficerEmail: "namasri.banerjee@mjunction.in",
      dealingOfficerPhone: "9999999999",
    };

    const result = buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID);

    expect(result).not.toBeNull();
    expect(result?.tenderNumber).toBe("1400013728");
    expect(result?.title).toBe("MJ/C04/2026/3699-SLEEVE");
    expect(result?.department).toBe("ISP MATERIAL MANAGEMENT DEPARTMENT");
    expect(result?.category).toBe("Insulation Material");
    expect(result?.location).toBe("Burnpur");
    expect(result?.state).toBe("West Bengal");
    expect(result?.estimatedCost).toBe(250000);
    expect(result?.submissionDate).toEqual(new Date("2026-07-20T15:00:00"));
    expect(result?.openingDate).toEqual(new Date("2026-07-13"));
    expect(result?.dealingOfficerEmail).toBe("namasri.banerjee@mjunction.in");
    expect(result?.businessId).toBe(BUSINESS_ID);
    expect(result?.createdById).toBe(CREATED_BY_ID);
    expect(result?.remarks).toContain("Some remark from the document");
    expect(result?.remarks).not.toContain("Placeholder values");
  });

  it("placeholders every missing-but-required field and lists them in remarks", () => {
    const fields: TenderExtractionFields = {
      tenderNumber: "1400013728",
      submissionDate: "2026-07-20T15:00:00",
    };

    const result = buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID);

    expect(result).not.toBeNull();
    expect(result?.title).toBe("1400013728");
    expect(result?.department).toBe("Not specified");
    expect(result?.type).toBe("Not specified");
    expect(result?.category).toBe("General");
    expect(result?.location).toBe("Not specified");
    expect(result?.state).toBe("Not specified");
    expect(result?.estimatedCost).toBe(0);
    expect(result?.remarks).toContain("Placeholder values");
    expect(result?.remarks).toContain("department");
    expect(result?.remarks).toContain("category");
    expect(result?.remarks).toContain("estimatedCost");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- tenders/local-docs/__tests__/incoming-tender-mapper.spec.ts
```

Expected: FAIL — `Cannot find module '../incoming-tender-mapper.js'`.

- [ ] **Step 4: Implement `buildDraftTenderData`**

Create `apps/server/src/modules/tenders/local-docs/incoming-tender-mapper.ts`:
```ts
import type { TenderExtractionFields } from "@bmp/types";

import type { CreateTenderData } from "../tenders.repository.js";

const PLACEHOLDER_FIELDS = [
  "department",
  "type",
  "category",
  "location",
  "state",
  "estimatedCost",
] as const;

function buildRemarksNote(fields: TenderExtractionFields): string {
  const placeholdered = PLACEHOLDER_FIELDS.filter((key) => fields[key] === undefined);
  const prefix =
    placeholdered.length > 0
      ? `[Auto-created from incoming-tenders ingestion. Placeholder values — verify before finalizing: ${placeholdered.join(", ")}.]\n\n`
      : "[Auto-created from incoming-tenders ingestion.]\n\n";
  return prefix + (fields.remarks ?? "");
}

// Returns null when tenderNumber or submissionDate is missing — these two are never
// guessed (see the plan's Global Constraints); the caller leaves the source file in
// place for manual handling instead of creating a tender with a fabricated number or
// deadline.
export function buildDraftTenderData(
  fields: TenderExtractionFields,
  businessId: string,
  createdById: string,
): Omit<CreateTenderData, "clientId"> | null {
  if (!fields.tenderNumber || !fields.submissionDate) return null;

  return {
    tenderNumber: fields.tenderNumber,
    title: fields.title ?? fields.tenderNumber,
    department: fields.department ?? "Not specified",
    type: fields.type ?? "Not specified",
    category: fields.category ?? "General",
    location: fields.location ?? "Not specified",
    state: fields.state ?? "Not specified",
    estimatedCost: fields.estimatedCost ?? 0,
    emdAmount: fields.emdAmount ?? null,
    tenderFee: fields.tenderFee ?? null,
    documentFee: fields.documentFee ?? null,
    submissionDate: new Date(fields.submissionDate),
    openingDate: fields.openingDate ? new Date(fields.openingDate) : null,
    validityPeriodDays: fields.validityPeriodDays ?? null,
    description: fields.description ?? null,
    remarks: buildRemarksNote(fields),
    dealingOfficerName: fields.dealingOfficerName ?? null,
    dealingOfficerEmail: fields.dealingOfficerEmail ?? null,
    dealingOfficerPhone: fields.dealingOfficerPhone ?? null,
    businessId,
    createdById,
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- tenders/local-docs/__tests__/incoming-tender-mapper.spec.ts
```

Expected: PASS, all 4 cases green.

- [ ] **Step 6: Verify the two export changes didn't break anything**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/tenders/local-docs/incoming-tender-mapper.ts apps/server/src/modules/tenders/local-docs/__tests__/incoming-tender-mapper.spec.ts apps/server/src/modules/tenders/tenders.module.ts apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts
git commit -m "feat(tenders): add incoming-tender field-mapping with placeholder/flag convention"
```

---

### Task 2: Watcher and orchestration

**Files:**
- Create: `apps/server/src/modules/tenders/local-docs/incoming-tenders.service.ts`
- Create: `apps/server/src/modules/tenders/local-docs/__tests__/incoming-tenders.service.integration.spec.ts`

**Interfaces:**
- Consumes: `buildDraftTenderData` (Task 1), `getSystemUserId`/`expandHome` (existing, from `docs-watcher.service.ts`/`folder-naming.ts`), `ensureTenderFolders`/`tenderFolderName` (existing, from `folder-naming.ts`), `tenderExtractionService` (Task 1's export — used only in `startIncomingTendersWatcher`, NOT in `processIncomingTenderFile`, so tests can inject a fake), `tendersService`/`organizationsService`/`boqService`/`auditService` (existing exported singletons), `ConflictError` (existing, from `apps/server/src/core/errors/HttpErrors.js`).
- Produces: `processIncomingTenderFile(rootDir: string, absolutePath: string, extractionService: TenderExtractionService): Promise<void>` (the per-file handler — takes the extraction service as an explicit parameter specifically so tests can substitute a fake one, matching `tender-extraction.service.spec.ts`'s own `ExtractTextFn` fake-injection convention, without needing real Ollama or a real PDF binary), `startIncomingTendersWatcher(rootDirRaw: string): Promise<FSWatcher>` (consumed by Task 3's `worker.ts` wiring).

- [ ] **Step 1: Write the failing integration test**

Read `apps/server/src/modules/tenders/local-docs/__tests__/docs-watcher.service.integration.spec.ts` first — mirror its exact fixture-setup conventions (real `User`/`Business`/`Organization` rows created directly via Prisma in `beforeAll`, `randomUUID()`-suffixed unique values, cleanup in `afterAll`).

Create `apps/server/src/modules/tenders/local-docs/__tests__/incoming-tenders.service.integration.spec.ts`:
```ts
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ExtractTextFn, GenerateJsonFn } from "../../tender-extraction.service.js";
import { TenderExtractionService } from "../../tender-extraction.service.js";
import { organizationsRepository } from "../../../organizations/organizations.module.js";
import { processIncomingTenderFile } from "../incoming-tenders.service.js";

// Real text shape from the SAIL/IISCO template's scrambled header layout (see
// tender-header.parser.ts's own doc comment) — enough for parseIiscoHeaderFields to
// recognize it and extract deterministically, no LLM/Ollama needed. Parameterized by
// tenderNumber/clientName so each test case gets its own unique values — tenderNumber
// is a real @unique DB column and this file's tests share one Postgres, so two tests
// using the same literal number would collide (the whole point of the "duplicate"
// test below is to prove a collision is handled — it must not happen by accident
// between unrelated tests too).
function buildSailFixtureText(tenderNumber: string, clientName: string): string {
  return `${clientName}
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)
ISP MATERIAL MANAGEMENT DEPARTMENT
Amendment Date:Amendment No:
Contracting Agency:13.07.2026TE Date:
MJ/C04/2026/3699-SLEEVE
${tenderNumber}
RFQ Title:
TE No:
07.07.2026 15:00:00 HrsBid Submission Deadline
90Quotation validity in days
Two Part Bid ResponseBid Type
Namasri Banerjeenamasri.banerjee@mjunction.in
RFQ Item Details
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171301005600045         250.000 M11.04.2026
Material Long Description
:
TUBE MATERIAL: POLYURETHANE
Item Additional
Description:`;
  // The "RFQ Item Details" block above is the exact, already-proven fixture shape
  // from tender-extraction.service.spec.ts's own TEXT_WITH_ONE_ITEM constant —
  // reused verbatim so parseIiscoRfqItems (a separate function from the header
  // parser, scanning this same full text for its own anchor) produces one real
  // item. Without it, result.items would be empty and boqService.commitBoq would
  // never be called, so Test 1 below wouldn't actually exercise the BOQ-commit path.
}

const NO_TENDER_NUMBER_TEXT = "This document has no recognizable tender fields at all.";
const CLIENT_NAME_PREFIX = "Incoming Tenders Test Client";

const fakeGenerateJson: GenerateJsonFn = async () => ({});

describe("incoming-tenders ingestion (integration)", () => {
  let rootDir: string;
  let businessId: string;
  let businessCode: string;
  let userId: string;

  beforeAll(async () => {
    businessCode = `INGEST${randomUUID().slice(0, 6)}`;
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Ingestion Test Business ${randomUUID()}`, code: businessCode },
    });
    businessId = business.id;

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: "local-sync@bmp.local",
        firstName: "Local Folder",
        lastName: "Sync",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { businessId } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: CLIENT_NAME_PREFIX } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "incoming-tenders-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function fakeExtractionService(text: string): TenderExtractionService {
    const fakeExtractText: ExtractTextFn = async () => text;
    return new TenderExtractionService(organizationsRepository, fakeGenerateJson, fakeExtractText);
  }

  it("creates a DRAFT tender, client org, and BOQ from a recognized document", async () => {
    const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
    const clientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });
    const filePath = path.join(incomingDir, "BID-fixture.PDF");
    await writeFile(filePath, "fake pdf bytes — extractText is faked, content here is irrelevant");

    await processIncomingTenderFile(
      rootDir,
      filePath,
      fakeExtractionService(buildSailFixtureText(tenderNumber, clientName)),
    );

    const tender = await prisma.tender.findFirst({ where: { businessId, tenderNumber } });
    expect(tender).not.toBeNull();
    expect(tender?.status).toBe("DRAFT");
    expect(tender?.remarks).toContain("Placeholder values");

    const organization = await prisma.organization.findFirst({ where: { name: clientName } });
    expect(organization).not.toBeNull();

    const boq = await prisma.boq.findFirst({ where: { tenderId: tender!.id }, include: { items: true } });
    expect(boq).not.toBeNull();
    expect(boq!.items.length).toBeGreaterThan(0);

    // Source file moved into the tender's NIT folder, not left in incoming-tenders/.
    const remainingIncoming = await readdir(incomingDir);
    expect(remainingIncoming).toEqual([]);
  });

  it("leaves the file in place when no tenderNumber/submissionDate can be extracted", async () => {
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });
    const filePath = path.join(incomingDir, "unrecognized.pdf");
    await writeFile(filePath, "fake pdf bytes");

    await processIncomingTenderFile(rootDir, filePath, fakeExtractionService(NO_TENDER_NUMBER_TEXT));

    const remaining = await readdir(incomingDir);
    expect(remaining).toEqual(["unrecognized.pdf"]);
  });

  it("moves the file to duplicates/ when the tenderNumber already exists", async () => {
    const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
    const preExistingClientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const incomingDir = path.join(rootDir, businessCode, "incoming-tenders");
    await mkdir(incomingDir, { recursive: true });

    const organization = await prisma.organization.create({
      data: { id: randomUUID(), name: preExistingClientName, type: "GOVERNMENT", createdById: userId },
    });
    await prisma.tender.create({
      data: {
        id: randomUUID(),
        tenderNumber,
        title: "Already exists",
        department: "Dept",
        clientId: organization.id,
        type: "Open",
        category: "General",
        location: "Somewhere",
        state: "Somewhere",
        estimatedCost: 0,
        submissionDate: new Date(),
        businessId,
        createdById: userId,
      },
    });

    const newClientName = `${CLIENT_NAME_PREFIX} ${randomUUID().slice(0, 8)}`;
    const filePath = path.join(incomingDir, "BID-fixture.PDF");
    await writeFile(filePath, "fake pdf bytes");

    await processIncomingTenderFile(
      rootDir,
      filePath,
      fakeExtractionService(buildSailFixtureText(tenderNumber, newClientName)),
    );

    const duplicatesDir = path.join(incomingDir, "duplicates");
    const duplicateFiles = await readdir(duplicatesDir);
    expect(duplicateFiles).toEqual(["BID-fixture.PDF"]);
    const remainingIncoming = (await readdir(incomingDir)).filter((name) => name !== "duplicates");
    expect(remainingIncoming).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker compose up -d postgres redis minio minio-init mailhog
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/local-docs/__tests__/incoming-tenders.service.integration.spec.ts
```

Expected: FAIL — `Cannot find module '../incoming-tenders.service.js'`.

- [ ] **Step 3: Implement `incoming-tenders.service.ts`**

Create `apps/server/src/modules/tenders/local-docs/incoming-tenders.service.ts`:
```ts
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import { ConflictError } from "../../../core/errors/HttpErrors.js";
import { generateJson } from "../../../infra/llm/ollama.client.js";
import { prisma } from "../../../infra/prisma/client.js";
import { logger } from "../../../shared/logger/logger.js";
import { auditService } from "../../audit/audit.module.js";
import { boqService } from "../../boq/boq.module.js";
import { organizationsRepository, organizationsService } from "../../organizations/organizations.module.js";
import { extractDocumentText } from "../tender-extraction.parser.js";
import { TenderExtractionService } from "../tender-extraction.service.js";
import { tendersService } from "../tenders.module.js";

import { getSystemUserId } from "./docs-watcher.service.js";
import { ensureTenderFolders, expandHome, tenderFolderName } from "./folder-naming.js";
import { buildDraftTenderData } from "./incoming-tender-mapper.js";

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

async function moveToSubfolder(rootDir: string, businessCode: string, filename: string, subfolder: string): Promise<void> {
  const targetDir = path.join(rootDir, businessCode, "incoming-tenders", subfolder);
  await mkdir(targetDir, { recursive: true });
  const sourcePath = path.join(rootDir, businessCode, "incoming-tenders", filename);
  await rename(sourcePath, path.join(targetDir, filename));
}

export async function processIncomingTenderFile(
  rootDir: string,
  absolutePath: string,
  extractionService: TenderExtractionService,
): Promise<void> {
  const relative = path.relative(rootDir, absolutePath);
  const segments = relative.split(path.sep);
  // Only [businessCode, "incoming-tenders", filename] — 3 segments exactly. A path
  // inside incoming-tenders/duplicates/ or incoming-tenders/errors/ (created by this
  // same function below) has 4 segments and must NOT be re-processed.
  if (segments.length !== 3) return;

  const [businessCode, folderSegment, filename] = segments;
  if (folderSegment !== "incoming-tenders") return;

  const mimeType = EXTENSION_TO_MIME_TYPE[path.extname(filename!).toLowerCase()];
  if (!mimeType) return; // ignore stray non-document files (e.g. .DS_Store)

  const business = await prisma.business.findUnique({ where: { code: businessCode! }, select: { id: true } });
  if (!business) {
    logger.warn(`Incoming tenders: no business matches folder "${businessCode}" — skipping ${relative}`);
    return;
  }

  const buffer = await readFile(absolutePath);
  const result = await extractionService.extractFromDocument(buffer, mimeType);

  const systemUserId = await getSystemUserId();
  const draft = buildDraftTenderData(result.fields, business.id, systemUserId);
  if (!draft) {
    logger.warn(
      `Incoming tenders: could not extract tenderNumber/submissionDate from "${filename}" — leaving in place for manual review`,
    );
    return;
  }

  let clientId = result.suggestedClientId;
  if (!clientId) {
    const clientName = result.suggestedClientName ?? draft.title;
    const organization = await organizationsService.create({
      name: clientName,
      type: "PRIVATE",
      notes: "Auto-created from incoming-tenders ingestion — verify type/GST/address.",
      createdById: systemUserId,
    });
    clientId = organization.id;
  }

  let tender;
  try {
    tender = await tendersService.create({ ...draft, clientId }, { businessId: business.id });
  } catch (error) {
    if (error instanceof ConflictError) {
      await moveToSubfolder(rootDir, businessCode!, filename!, "duplicates");
      logger.warn(
        `Incoming tenders: tender ${draft.tenderNumber} already exists — moved "${filename}" to duplicates/`,
      );
      return;
    }
    throw error;
  }

  if (result.items.length > 0) {
    await boqService.commitBoq(
      tender.id,
      business.id,
      {
        items: result.items.map((item, index) => ({
          tempId: String(index),
          itemCode: item.itemCode,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
        })),
      },
      systemUserId,
      {},
    );
  }

  // tendersService.create() already fire-and-forgets ensureTenderFolders — call it
  // again ourselves, awaited, so the NIT folder is guaranteed to exist before this
  // function moves the file into it (the fire-and-forget call inside create() has
  // no guaranteed completion time relative to this function returning).
  await ensureTenderFolders(rootDir, businessCode!, tender);
  const nitPath = path.join(
    expandHome(rootDir),
    businessCode!,
    "tenders",
    tenderFolderName(tender),
    "NIT",
    filename!,
  );
  await rename(absolutePath, nitPath);

  await auditService.log({
    actorId: systemUserId,
    action: "TENDER_AUTO_CREATED_FROM_INGESTION",
    entityType: "Tender",
    entityId: tender.id,
    metadata: { sourceFilename: filename, itemCount: result.items.length },
  });

  logger.info(`Incoming tenders: created tender ${tender.tenderNumber} from "${filename}"`);
}

export async function startIncomingTendersWatcher(rootDirRaw: string): Promise<FSWatcher> {
  const rootDir = expandHome(rootDirRaw);
  const extractionService = new TenderExtractionService(organizationsRepository, generateJson, extractDocumentText);

  const watcher = chokidar.watch(rootDir, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    depth: 3,
  });

  watcher.on("add", (filePath) => {
    void processIncomingTenderFile(rootDir, filePath, extractionService).catch((error: unknown) => {
      logger.error(
        `Incoming tenders: failed to process ${filePath}: ${error instanceof Error ? error.message : error}`,
      );
    });
  });

  logger.info(`Incoming tenders: watching ${rootDir}`);
  return watcher;
}
```

Check `apps/server/src/modules/organizations/organizations.module.ts` exports `organizationsRepository` alongside `organizationsService` (it does — see the plan's own research: `export { organizationsRepository };` at the bottom of that file) — the import above relies on both being available from the same module.

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/tenders/local-docs/__tests__/incoming-tenders.service.integration.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 5: Verify the whole server package typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/tenders/local-docs/incoming-tenders.service.ts apps/server/src/modules/tenders/local-docs/__tests__/incoming-tenders.service.integration.spec.ts
git commit -m "feat(tenders): add incoming-tenders folder watcher (extract, create tender, commit BOQ)"
```

---

### Task 3: Wire into the worker process and verify manually

**Files:**
- Modify: `apps/server/src/worker.ts`

**Interfaces:**
- Consumes: `startIncomingTendersWatcher` (Task 2).

- [ ] **Step 1: Wire the new watcher alongside the existing one**

In `apps/server/src/worker.ts`, change:
```ts
import { env } from "./config/env.js";
import { tenderReminderQueue } from "./infra/queue/queues.js";
import { startEmailWorker } from "./infra/queue/workers/email.worker.js";
import { startTenderReminderWorker } from "./infra/queue/workers/tender-reminder.worker.js";
import { startLocalDocsWatcher } from "./modules/tenders/local-docs/docs-watcher.service.js";
import { logger } from "./shared/logger/logger.js";

const emailWorker = startEmailWorker();
const tenderReminderWorker = startTenderReminderWorker();
const localDocsWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;

// Idempotent: BullMQ dedupes repeatable jobs by pattern + jobId, so
// re-registering on every worker boot is safe and required (there is no
// separate one-time "seed the schedule" step in this deployment).
await tenderReminderQueue.add(
  "check-deadlines",
  {},
  { repeat: { pattern: "0 7 * * *" }, jobId: "tender-deadline-check" },
);

logger.info(
  `Background worker process started (email queue, tender reminders${localDocsWatcher ? ", local docs sync" : ""})`,
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down worker...`);
  await Promise.all([emailWorker.close(), tenderReminderWorker.close(), localDocsWatcher?.close()]);
  process.exit(0);
}
```
to:
```ts
import { env } from "./config/env.js";
import { tenderReminderQueue } from "./infra/queue/queues.js";
import { startEmailWorker } from "./infra/queue/workers/email.worker.js";
import { startTenderReminderWorker } from "./infra/queue/workers/tender-reminder.worker.js";
import { startLocalDocsWatcher } from "./modules/tenders/local-docs/docs-watcher.service.js";
import { startIncomingTendersWatcher } from "./modules/tenders/local-docs/incoming-tenders.service.js";
import { logger } from "./shared/logger/logger.js";

const emailWorker = startEmailWorker();
const tenderReminderWorker = startTenderReminderWorker();
const localDocsWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const incomingTendersWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startIncomingTendersWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;

// Idempotent: BullMQ dedupes repeatable jobs by pattern + jobId, so
// re-registering on every worker boot is safe and required (there is no
// separate one-time "seed the schedule" step in this deployment).
await tenderReminderQueue.add(
  "check-deadlines",
  {},
  { repeat: { pattern: "0 7 * * *" }, jobId: "tender-deadline-check" },
);

logger.info(
  `Background worker process started (email queue, tender reminders${localDocsWatcher ? ", local docs sync" : ""}${incomingTendersWatcher ? ", incoming tenders ingestion" : ""})`,
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down worker...`);
  await Promise.all([
    emailWorker.close(),
    tenderReminderWorker.close(),
    localDocsWatcher?.close(),
    incomingTendersWatcher?.close(),
  ]);
  process.exit(0);
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 3: Manual verification against a real business folder**

With the worker running (`pnpm dev`, or restart the worker process if already running) and `LOCAL_DOCS_SYNC_ENABLED=true`:

```bash
mkdir -p ~/BMP-Businesses/ARCHIE/incoming-tenders
cp /path/to/any/tender.pdf ~/BMP-Businesses/ARCHIE/incoming-tenders/
```

Watch the worker's log output for `Incoming tenders: created tender ... from "..."` (or the appropriate warning/duplicate-move log line), then confirm via the API or UI that the tender, client, and BOQ exist as expected — same manual check already performed by hand this session for tender `1400013728`, now driven by the watcher instead of individual curl calls.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/worker.ts
git commit -m "feat(server): start the incoming-tenders watcher alongside local-docs sync"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered step in the spec's "New watcher" section (extract → no-tenderNumber stop → duplicate stop → resolve/create client → create tender with placeholders → commit BOQ → move into NIT) is implemented in Task 2's `processIncomingTenderFile`, in the same order. The spec's explicit non-goals (no email fetching, no UI toggle, no rate inference, no retry/backoff for unrecognized templates) are all respected — nothing in this plan touches any of them.
- **One addition beyond the spec's literal text, called out here for visibility:** the spec only named `tenderNumber` as a "never guess, stop instead" field. Writing the plan surfaced that `submissionDate` is equally required and equally unsafe to fabricate (a wrong deadline is an operational risk, not just a cosmetic placeholder) — extended the same "leave in place, don't guess" rule to it, folded into this plan's Global Constraints. This is a direct extension of the already-agreed principle (never invent business-critical data), not a new design decision.
- **Simplification from the spec:** the spec suggested a named `INCOMING_TENDERS_FOLDER_NAME` constant in `folder-naming.ts`. Since `"incoming-tenders"` is only ever referenced from the one new file (`incoming-tenders.service.ts`), a shared exported constant would be a one-caller abstraction — used as an inline string literal instead, consistent with this codebase's existing `"tenders"`/`"templates"` string literals (also not constants).
- **Type consistency:** `buildDraftTenderData`'s return type (`Omit<CreateTenderData, "clientId"> | null`) is spread with `clientId` added (`{ ...draft, clientId }`) before being passed to `tendersService.create()`, whose existing signature is `create(data: Omit<CreateTenderData, "businessId">, context: ScopedRequestContext)` — since `draft` already includes `businessId` (Task 1 puts it there) and `create()`'s own parameter type omits `businessId` from what it accepts as `data`... **verify this in Task 2 implementation:** `draft` from `buildDraftTenderData` includes `businessId`, but `tendersService.create()`'s `data` parameter type is `Omit<CreateTenderData, "businessId">` (businessId comes from `context`, not `data`). Task 2's code above passes `{ ...draft, clientId }` as `data` — this includes a `businessId` key that the parameter type doesn't declare, which TypeScript will reject as an excess property in an object literal spread into a typed parameter... **actually this depends on whether TS flags excess properties through a spread** — object spreads into a call argument do NOT trigger TypeScript's excess-property-check the way a literal does, so this compiles fine and the extra `businessId` key is simply ignored/harmless at runtime (Prisma create call inside the repository uses `context.businessId` separately per the existing `create()` implementation already read during planning: `this.tendersRepository.create({ ...data, businessId: context.businessId })`). No fix needed — flagging this reasoning explicitly so Task 2's implementer/reviewer doesn't need to re-derive it, since it looks like a mismatch at first glance but isn't one.
- **No placeholders:** every step has complete, runnable code; no TBD/TODO anywhere.
