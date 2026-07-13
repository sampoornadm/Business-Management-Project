# Template-Based Document Generation (Undertaking v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user generate a filled Undertaking `.docx` for a tender, from a template file the owner maintains themselves on disk, downloaded via a button on the Tender detail page.

**Architecture:** A new backend module (`document-generation`) reads a fixed-path `.docx` template file, fills `{{tag}}` placeholders with data pulled from the Tender (+ its Business and client Organization), and streams the result back as a download — no database schema changes, no upload UI, no version history. New dependency `docxtemplater`/`pizzip` fill the template; everything else follows existing module conventions.

**Tech Stack:** Express + Zod + Prisma (backend module), `docxtemplater` + `pizzip` (new deps), Next.js/React + TanStack Query (frontend).

## Global Constraints

- No backend schema changes — this plan adds zero Prisma migrations.
- Template file lives at `${TEMPLATES_ROOT_DIR}/undertaking.docx` (env var, default `~/BMP-Templates`, same tilde-expansion convention as the existing `LOCAL_DOCS_ROOT_DIR`). No upload endpoint — the owner places the file directly.
- Placeholder syntax is `{{tagName}}` (double curly), not docxtemplater's single-curly default — every `new Docxtemplater(...)` call must pass `delimiters: { start: "{{", end: "}}" }`.
- Output is a fresh download every time — nothing is saved as an `Attachment` or persisted anywhere.
- The file the owner places at the template path must be a plain `.docx` (not `.dotx`) — if their letterhead source is a `.dotx` "New from Template" starter, they create the actual Undertaking wording + `{{tags}}` in a new document from it in Word, then **Save As Word Document (.docx)** before placing it. State this explicitly in any user-facing error/instruction text — a `.dotx`'s internal content-type declaration can make a byte-renamed copy behave oddly in Word even though `docxtemplater`/`pizzip` can read it fine.
- Follow the standard module convention (`*.repository.ts`/`*.service.ts`/`*.controller.ts`/`*.routes.ts`/`*.module.ts`) for the new `document-generation` module.
- New permission key `tenders:generate_document`, granted to `TENDER_MANAGER` (and automatically to `ADMIN` via `ALL_STANDARD_PERMISSIONS`, and `SUPER_ADMIN` via the wildcard) — no separate migration needed, the seed script picks up `PERMISSION_KEYS`/`ROLE_PERMISSION_MATRIX` changes idempotently.

---

## File Structure

**New files:**
- `apps/server/src/modules/document-generation/document-generation.service.ts` — `getTemplateStatus`, `fillDocxTemplate` (pure), `generateUndertaking` (orchestrator).
- `apps/server/src/modules/document-generation/document-generation.controller.ts`
- `apps/server/src/modules/document-generation/document-generation.routes.ts`
- `apps/server/src/modules/document-generation/document-generation.module.ts`
- `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts`
- `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`
- `apps/web/src/hooks/use-document-generation.ts`

**Modified files:**
- `apps/server/src/modules/tenders/tenders.repository.ts` — new `findForDocumentGeneration` method + `TenderForDocumentGeneration` type.
- `apps/server/src/config/env.ts` — new `TEMPLATES_ROOT_DIR` env var.
- `docs/environment-variables.md` — document it.
- `apps/server/package.json` — add `docxtemplater`, `pizzip`.
- `packages/types/src/rbac.ts` — new `tenders:generate_document` permission key, granted to `TENDER_MANAGER_PERMISSIONS`.
- `apps/server/src/routes/v1.router.ts` — mount the new router at the existing `/tenders` prefix (same pattern as `boqRouter`).
- `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx` — "Generate Undertaking" button.

---

### Task 1: Tenders repository — data for document generation

**Files:**
- Modify: `apps/server/src/modules/tenders/tenders.repository.ts`

**Interfaces:**
- Produces: `TenderForDocumentGeneration` type and `ITendersRepository.findForDocumentGeneration(id: string, businessId: string): Promise<TenderForDocumentGeneration | null>`, consumed by Task 4 (service orchestrator).

- [ ] **Step 1: Add the Prisma args + type**

In `apps/server/src/modules/tenders/tenders.repository.ts`, add after the existing `tenderDetailArgs`/`TenderDetail` block (after line 39's `export type TenderAssigneeWithRelations = TenderDetail["assignees"][number];`):

```ts
const tenderDocGenArgs = {
  include: {
    business: { select: { name: true, address: true, gstNumber: true, panNumber: true } },
    client: { select: { name: true, address: true } },
  },
} satisfies Prisma.TenderDefaultArgs;

export type TenderForDocumentGeneration = Prisma.TenderGetPayload<typeof tenderDocGenArgs>;
```

- [ ] **Step 2: Add the method to the interface**

In the same file, add to `ITendersRepository` (after `findByTenderNumber`):

```ts
  findForDocumentGeneration(id: string, businessId: string): Promise<TenderForDocumentGeneration | null>;
```

- [ ] **Step 3: Implement it**

Add to the `TendersRepository` class, after `findByTenderNumber` — mirrors `findById`'s `findFirst` shape exactly (same reason: no compound unique constraint on `(id, businessId)`):

```ts
  findForDocumentGeneration(id: string, businessId: string): Promise<TenderForDocumentGeneration | null> {
    return this.prisma.tender.findFirst({ where: { id, businessId }, ...tenderDocGenArgs });
  }
```

- [ ] **Step 4: Verify it typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/tenders/tenders.repository.ts
git commit -m "feat(tenders): add findForDocumentGeneration repository method"
```

---

### Task 2: Template status check (fs-based, no DB)

**Files:**
- Create: `apps/server/src/modules/document-generation/document-generation.service.ts` (this task only adds `getTemplateStatus` — Tasks 3/4 add the rest to the same file)
- Create: `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` (this task only adds the `getTemplateStatus` describe block — Tasks 3/4 add more to the same file)
- Modify: `apps/server/src/config/env.ts`
- Modify: `docs/environment-variables.md`

**Interfaces:**
- Consumes: `expandHome` from `apps/server/src/modules/tenders/local-docs/folder-naming.ts` (existing, tilde-expansion helper).
- Produces: `TemplateStatus` type, `getTemplateStatus(documentType: "undertaking"): Promise<TemplateStatus>`, `getTemplatePath(documentType: "undertaking"): string` — consumed by Task 4 (`generateUndertaking`) and Task 5 (controller error message).

- [ ] **Step 1: Add the env var**

In `apps/server/src/config/env.ts`, add this line immediately after `LOCAL_DOCS_ROOT_DIR: z.string().default("~/BMP-Tenders"),`:

```ts
  TEMPLATES_ROOT_DIR: z.string().default("~/BMP-Templates"),
```

- [ ] **Step 2: Document it**

In `docs/environment-variables.md`'s `## Server` table, add this row immediately after the `BACKUP_RETENTION_DAYS` row:

```markdown
| `TEMPLATES_ROOT_DIR` | No (default `~/BMP-Templates`) | No | Folder where document-generation templates live, one fixed-name file per document type (e.g. `undertaking.docx`). No upload UI — place the file directly. It must be a plain `.docx` (not `.dotx`): if you built it from a `.dotx` letterhead starter in Word, use File > Save As > Word Document before placing it here. |
```

- [ ] **Step 3: Write the failing test**

Create `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/env.js", () => ({ env: { TEMPLATES_ROOT_DIR: "" } }));

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
    (env as { TEMPLATES_ROOT_DIR: string }).TEMPLATES_ROOT_DIR = tempDir;
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("undertaking");

    expect(status.exists).toBe(false);
    expect(status.lastModifiedAt).toBeNull();
    expect(status.filename).toBe("undertaking.docx");
  });

  it("reports exists: true with the file's mtime when present", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { TEMPLATES_ROOT_DIR: string }).TEMPLATES_ROOT_DIR = tempDir;
    await writeFile(path.join(tempDir, "undertaking.docx"), "fake docx bytes");
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("undertaking");

    expect(status.exists).toBe(true);
    expect(status.lastModifiedAt).not.toBeNull();
    expect(new Date(status.lastModifiedAt!).getTime()).not.toBeNaN();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: FAIL — `Cannot find module '../document-generation.service.js'`.

- [ ] **Step 5: Implement `getTemplateStatus`**

Create `apps/server/src/modules/document-generation/document-generation.service.ts`:

```ts
import { stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env.js";
import { expandHome } from "../tenders/local-docs/folder-naming.js";

export type DocumentType = "undertaking";

export interface TemplateStatus {
  documentType: DocumentType;
  filename: string;
  path: string;
  exists: boolean;
  lastModifiedAt: string | null;
}

const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
};

export function getTemplatePath(documentType: DocumentType): string {
  return path.join(expandHome(env.TEMPLATES_ROOT_DIR), TEMPLATE_FILENAMES[documentType]);
}

export async function getTemplateStatus(documentType: DocumentType): Promise<TemplateStatus> {
  const templatePath = getTemplatePath(documentType);
  try {
    const stats = await stat(templatePath);
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: true,
      lastModifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: false,
      lastModifiedAt: null,
    };
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: PASS, both cases green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/config/env.ts docs/environment-variables.md apps/server/src/modules/document-generation/document-generation.service.ts apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts
git commit -m "feat(document-generation): add template status check (fs-based, no DB)"
```

---

### Task 3: Docx template fill (pure function, TDD with an in-memory fixture)

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts` (add `fillDocxTemplate`)
- Modify: `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` (add a `fillDocxTemplate` describe block)
- Modify: `apps/server/package.json`

**Interfaces:**
- Produces: `fillDocxTemplate(templateBuffer: Buffer, data: Record<string, string>): Buffer`, consumed by Task 4 (`generateUndertaking`).

This task needs a real (but tiny, hand-built) `.docx` byte buffer to test against — not a checked-in binary file, since a `.docx` is just a zip of a few small XML parts, and building one in-memory with `pizzip` keeps the test self-contained and avoids committing binary fixtures to git.

- [ ] **Step 1: Add the dependencies**

In `apps/server/package.json`, add to `"dependencies"` (alphabetical order — between `"cors"` and `"exceljs"` add `docxtemplater`, and between `"nodemailer"` and `"pdf-parse"` add `pizzip`):

```json
    "docxtemplater": "^3.55.0",
```

```json
    "pizzip": "^3.1.7",
```

Then run:

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

Add this to `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` (new imports at the top, new `describe` block at the bottom):

```ts
import PizZip from "pizzip";
```

```ts
function buildTestDocxBuffer(bodyText: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body>` +
      "</w:document>",
  );
  return zip.generate({ type: "nodebuffer" });
}

describe("fillDocxTemplate", () => {
  it("replaces {{tag}} placeholders with the given values", async () => {
    const { fillDocxTemplate } = await import("../document-generation.service.js");
    const template = buildTestDocxBuffer("Dear {{clientOrganizationName}}, re: {{tenderNumber}}.");

    const result = fillDocxTemplate(template, {
      clientOrganizationName: "Acme Corp",
      tenderNumber: "TEN-001",
    });

    const resultZip = new PizZip(result);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Dear Acme Corp, re: TEN-001.");
    expect(documentXml).not.toContain("{{clientOrganizationName}}");
    expect(documentXml).not.toContain("{{tenderNumber}}");
  });

  it("throws a clear error when the template has unresolved tags outside the provided data", async () => {
    const { fillDocxTemplate } = await import("../document-generation.service.js");
    const template = buildTestDocxBuffer("Hello {{unknownTag}}.");

    expect(() => fillDocxTemplate(template, {})).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: FAIL — `fillDocxTemplate is not a function` (or not exported).

- [ ] **Step 4: Implement `fillDocxTemplate`**

Add to `apps/server/src/modules/document-generation/document-generation.service.ts` — new imports at the top, new function alongside `getTemplateStatus`:

```ts
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
```

```ts
export function fillDocxTemplate(templateBuffer: Buffer, data: Record<string, string>): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: PASS, all 4 cases (2 from Task 2, 2 new) green.

If the "unresolved tags" case doesn't throw, docxtemplater's default is actually to render unresolved tags as empty strings rather than throw — that's the more common real-world default. In that case, change the test's expectation to `expect(fillDocxTemplate(template, {})).toBeInstanceOf(Buffer)` (unresolved tags render blank, which is the correct behavior for this feature — an unused merge field is not fatal) and remove the `.toThrow()` assertion. Use whichever behavior the library actually exhibits; don't fight the library's default to force a throw.

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/modules/document-generation/document-generation.service.ts apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts
git commit -m "feat(document-generation): add docx template fill via docxtemplater"
```

---

### Task 4: Service orchestration (`generateUndertaking`)

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts` (add `generateUndertaking`)
- Modify: `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` (add a `generateUndertaking` describe block)

**Interfaces:**
- Consumes: `ITendersRepository.findForDocumentGeneration` (Task 1), `getTemplatePath`/`getTemplateStatus` (Task 2), `fillDocxTemplate` (Task 3).
- Produces: `generateUndertaking(tendersRepository: Pick<ITendersRepository, "findForDocumentGeneration">, tenderId: string, businessId: string): Promise<Buffer>`, consumed by Task 5 (controller).

- [ ] **Step 1: Write the failing tests**

Add this to `apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts` (new imports at top, new `describe` block at the bottom):

```ts
import { writeFile, mkdir } from "node:fs/promises";
```

```ts
describe("generateUndertaking", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-"));
    const { env } = await import("../../../config/env.js");
    (env as { TEMPLATES_ROOT_DIR: string }).TEMPLATES_ROOT_DIR = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

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

    const { generateUndertaking } = await import("../document-generation.service.js");
    const result = await generateUndertaking(fakeTendersRepository, "tender-1", "business-1");

    const resultZip = new PizZip(result);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Dear Acme Corp, re: TEN-001 - Road Widening, from Archie Udyog (GST 27AAAAA0000A1Z5).");
    expect(fakeTendersRepository.findForDocumentGeneration).toHaveBeenCalledWith("tender-1", "business-1");
  });

  it("throws NotFoundError when the tender doesn't exist for that business", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue(null),
    };
    const { generateUndertaking } = await import("../document-generation.service.js");

    await expect(generateUndertaking(fakeTendersRepository, "missing", "business-1")).rejects.toThrow(
      "Tender not found",
    );
  });

  it("throws a clear error when the template file is missing", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        department: "PWD",
        business: { name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const { generateUndertaking } = await import("../document-generation.service.js");

    await expect(generateUndertaking(fakeTendersRepository, "tender-1", "business-1")).rejects.toThrow(
      /template not found/i,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: FAIL — `generateUndertaking is not a function`.

- [ ] **Step 3: Implement `generateUndertaking`**

Add to `apps/server/src/modules/document-generation/document-generation.service.ts` — new imports at the top, new function at the bottom:

```ts
import { readFile } from "node:fs/promises";
```

```ts
import { NotFoundError } from "../../core/errors/HttpErrors.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";
```

```ts
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export async function generateUndertaking(
  tendersRepository: Pick<ITendersRepository, "findForDocumentGeneration">,
  tenderId: string,
  businessId: string,
): Promise<Buffer> {
  const tender = await tendersRepository.findForDocumentGeneration(tenderId, businessId);
  if (!tender) throw new NotFoundError("Tender not found");

  const status = await getTemplateStatus("undertaking");
  if (!status.exists) {
    throw new NotFoundError(`Undertaking template not found. Place it at ${status.path}`);
  }

  const templateBuffer = await readFile(status.path);
  const data: Record<string, string> = {
    tenderNumber: tender.tenderNumber,
    tenderTitle: tender.title,
    tenderDepartment: tender.department,
    businessName: tender.business.name,
    businessAddress: tender.business.address ?? "",
    businessGstNumber: tender.business.gstNumber ?? "",
    businessPanNumber: tender.business.panNumber ?? "",
    clientOrganizationName: tender.client.name,
    clientOrganizationAddress: tender.client.address ?? "",
    generatedDate: formatDate(new Date()),
  };

  return fillDocxTemplate(templateBuffer, data);
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm --filter @bmp/server test -- document-generation/__tests__/document-generation.service.spec.ts
```

Expected: PASS, all cases green (7 total across the file: 2 template-status + 2 fill-template + 3 generate-undertaking).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/document-generation/document-generation.service.ts apps/server/src/modules/document-generation/__tests__/document-generation.service.spec.ts
git commit -m "feat(document-generation): add generateUndertaking orchestrator"
```

---

### Task 5: Controller, routes, permission, module composition

**Files:**
- Create: `apps/server/src/modules/document-generation/document-generation.controller.ts`
- Create: `apps/server/src/modules/document-generation/document-generation.routes.ts`
- Create: `apps/server/src/modules/document-generation/document-generation.module.ts`
- Create: `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`
- Modify: `packages/types/src/rbac.ts`
- Modify: `apps/server/src/routes/v1.router.ts`

**Interfaces:**
- Consumes: `generateUndertaking` (Task 4), `tendersRepository` (existing, exported from `apps/server/src/modules/tenders/tenders.module.ts`).
- Produces: `POST /tenders/:id/documents/undertaking` HTTP route, consumed by Task 6 (frontend hook).

- [ ] **Step 1: Add the permission key**

In `packages/types/src/rbac.ts`, add `"tenders:generate_document",` immediately after `"tenders:change_status",` in the `PERMISSION_KEYS` array (line ~34).

Then add `"tenders:generate_document",` to `TENDER_MANAGER_PERMISSIONS` (immediately after `"tenders:change_status",` in that array, in the same file).

- [ ] **Step 2: Write the controller**

Create `apps/server/src/modules/document-generation/document-generation.controller.ts`:

```ts
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking } from "./document-generation.service.js";

export class DocumentGenerationController {
  constructor(private readonly tendersRepository: ITendersRepository) {}

  generateUndertaking = asyncHandler(async (req, res) => {
    const buffer = await generateUndertaking(this.tendersRepository, req.params.id!, req.user!.businessId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="Undertaking-${req.params.id}.docx"`);
    res.send(buffer);
  });
}
```

- [ ] **Step 3: Write the routes**

Create `apps/server/src/modules/document-generation/document-generation.routes.ts`:

```ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";

import type { DocumentGenerationController } from "./document-generation.controller.js";

export function createDocumentGenerationRouter(controller: DocumentGenerationController): Router {
  const router = Router();

  /**
   * @openapi
   * /tenders/{id}/documents/undertaking:
   *   post:
   *     tags: [Document Generation]
   *     summary: Generate a filled Undertaking .docx for a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Generated .docx file }
   *       404: { description: Tender not found, or the template file is missing }
   */
  router.post(
    "/:id/documents/undertaking",
    authenticateMiddleware,
    requirePermission("tenders:generate_document"),
    controller.generateUndertaking,
  );

  return router;
}
```

- [ ] **Step 4: Write the module composition root**

Create `apps/server/src/modules/document-generation/document-generation.module.ts`:

```ts
import { tendersRepository } from "../tenders/tenders.module.js";

import { DocumentGenerationController } from "./document-generation.controller.js";
import { createDocumentGenerationRouter } from "./document-generation.routes.js";

const documentGenerationController = new DocumentGenerationController(tendersRepository);

export const documentGenerationRouter = createDocumentGenerationRouter(documentGenerationController);
```

- [ ] **Step 5: Mount the router**

In `apps/server/src/routes/v1.router.ts`, add the import (alphabetically among the existing module imports, near the `boqItemsRouter, boqRouter` import):

```ts
import { documentGenerationRouter } from "../modules/document-generation/document-generation.module.js";
```

and mount it at the existing `/tenders` prefix, immediately after the existing `v1Router.use("/tenders", tendersRouter);` line:

```ts
v1Router.use("/tenders", documentGenerationRouter);
```

(This mirrors exactly how `boqRouter` is already mounted at the same `/tenders` prefix as a separate module's router.)

- [ ] **Step 6: Write the integration test**

Create `apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import PizZip from "pizzip";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { createIntegrationTestUser, cleanupIntegrationTestUser, type IntegrationTestUser } from "../../../shared/test-utils/integration-auth.js";

function buildTestDocxBuffer(bodyText: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body>` +
      "</w:document>",
  );
  return zip.generate({ type: "nodebuffer" });
}

/**
 * Requires a real Postgres + Redis reachable via .env.test, with migrations applied.
 * Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("POST /tenders/:id/documents/undertaking (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let tenderId: string;
  let clientOrgId: string;
  let templatesDir: string;
  const originalTemplatesRootDir = process.env.TEMPLATES_ROOT_DIR;

  beforeAll(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-integration-"));
    process.env.TEMPLATES_ROOT_DIR = templatesDir;
  });

  afterAll(async () => {
    await rm(templatesDir, { recursive: true, force: true });
    if (originalTemplatesRootDir) process.env.TEMPLATES_ROOT_DIR = originalTemplatesRootDir;
  });

  beforeEach(async () => {
    testUser = await createIntegrationTestUser(app);
    const clientOrg = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: "Integration Client Org",
        type: "GOVERNMENT",
        createdById: testUser.userId,
      },
    });
    clientOrgId = clientOrg.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `TEN-${randomUUID().slice(0, 8)}`,
        title: "Integration Test Tender",
        department: "Test Dept",
        clientId: clientOrgId,
        type: "OPEN",
        category: "CIVIL",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: new Date(),
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
  });

  afterEach(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await cleanupIntegrationTestUser(testUser);
  });

  it("generates a filled docx when the template exists", async () => {
    await mkdir(templatesDir, { recursive: true });
    await writeFile(
      path.join(templatesDir, "undertaking.docx"),
      buildTestDocxBuffer("Tender {{tenderNumber}} for {{clientOrganizationName}}."),
    );

    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/documents/undertaking`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const resultZip = new PizZip(response.body as Buffer);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Integration Client Org");
  });

  it("returns 404 with a clear message when the template file is missing", async () => {
    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/documents/undertaking`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/template not found/i);
  });

  it("returns 404 for a tender that doesn't belong to the caller's business", async () => {
    const response = await request(app)
      .post(`/api/v1/tenders/${randomUUID()}/documents/undertaking`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run the integration test**

Requires `docker compose up -d postgres redis minio minio-init mailhog` running. Then:

```bash
pnpm exec dotenv -e .env.test -- pnpm --filter @bmp/server exec vitest run src/modules/document-generation/__tests__/document-generation.integration.spec.ts
```

Expected: PASS, all 3 cases green.

- [ ] **Step 8: Verify the whole server package typechecks**

```bash
pnpm --filter @bmp/server typecheck
```

Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add packages/types/src/rbac.ts apps/server/src/routes/v1.router.ts apps/server/src/modules/document-generation/document-generation.controller.ts apps/server/src/modules/document-generation/document-generation.routes.ts apps/server/src/modules/document-generation/document-generation.module.ts apps/server/src/modules/document-generation/__tests__/document-generation.integration.spec.ts
git commit -m "feat(document-generation): add POST /tenders/:id/documents/undertaking endpoint"
```

---

### Task 6: Frontend download hook

**Files:**
- Create: `apps/web/src/hooks/use-document-generation.ts`

**Interfaces:**
- Produces: `downloadUndertaking(tenderId: string): Promise<void>`, consumed by Task 7 (Tender detail page button).

This mirrors the existing blob-download pattern already used for report exports in `apps/web/src/hooks/use-reports.ts`'s `downloadReportExport` function — same shape, just a POST instead of a GET and a fixed filename.

- [ ] **Step 1: Create the hook file**

Create `apps/web/src/hooks/use-document-generation.ts`:

```ts
"use client";

import { apiClient } from "@/lib/axios";

export async function downloadUndertaking(tenderId: string): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/undertaking`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Undertaking-${tenderId}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-document-generation.ts
git commit -m "feat(web): add downloadUndertaking hook"
```

---

### Task 7: "Generate Undertaking" button on the Tender detail page

**Files:**
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Consumes: `downloadUndertaking` (Task 6).

- [ ] **Step 1: Add the import and permission check**

In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, add the import alongside the existing `lucide-react` import:

```ts
import { Download, Pencil, Trash2 } from "lucide-react";
```

(replacing the existing `import { Pencil, Trash2 } from "lucide-react";` line), and add the import:

```ts
import { downloadUndertaking } from "@/hooks/use-document-generation";
```

Add this alongside the existing permission checks (`canUpdate`, `canDelete`, etc.):

```ts
  const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");
```

- [ ] **Step 2: Add the download handler**

Add this function alongside the existing `handleDelete`/`handleStatusChange` functions:

```ts
  async function handleGenerateUndertaking() {
    try {
      await downloadUndertaking(tender.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not generate document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }
```

- [ ] **Step 3: Add the button**

In the action-buttons area (the `<div className="flex shrink-0 gap-2">` block), add this button — placed before the existing `Edit` button:

```tsx
          {canGenerateDocument && (
            <Button variant="outline" onClick={handleGenerateUndertaking}>
              <Download className="mr-2 h-4 w-4" /> Generate Undertaking
            </Button>
          )}
```

- [ ] **Step 4: Verify it typechecks**

```bash
pnpm --filter @bmp/web typecheck
```

Expected: exits 0.

- [ ] **Step 5: Manually verify in the browser**

1. Place a test `.docx` file (any real Word document containing text like `Tender {{tenderNumber}} for {{clientOrganizationName}}, submitted by {{businessName}}.`) at `~/BMP-Templates/undertaking.docx` (or wherever `TEMPLATES_ROOT_DIR` resolves to in your `.env`).
2. Start the app, log in, open any tender's detail page.
3. Confirm the "Generate Undertaking" button appears (for a role with `tenders:generate_document` — Tender Manager, Admin, or Super Admin) and downloads a `.docx` file when clicked.
4. Open the downloaded file — confirm the placeholders are replaced with real tender/business/client data and the rest of your letterhead/formatting is intact.
5. Temporarily rename/remove the template file and click the button again — confirm a clear toast error appears mentioning the expected path, not a generic failure.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/tenders/\[id\]/page.tsx
git commit -m "feat(web): add Generate Undertaking button to tender detail page"
```

---

## Self-Review Notes

- **Spec coverage:** template location + no-upload-UI (Task 2), "current template" visibility via mtime (Task 2's `getTemplateStatus`), placeholder dictionary (Task 4's `data` map matches the spec's table exactly), generation endpoint (Task 5), tender-detail-page trigger (Task 7), download-only output (Tasks 5-7, no `Attachment` writes anywhere), missing-template error messaging (Task 4 + Task 5's 404 + Task 7's toast) — all covered. The `.dotx`→`.docx` Save-As guidance from the Global Constraints is surfaced in the `docs/environment-variables.md` entry (Task 2) and the manual-verification steps (Task 7).
- **Type consistency:** `TenderForDocumentGeneration` (Task 1) flows unchanged into `generateUndertaking`'s parameter type (Task 4, via `Pick<ITendersRepository, "findForDocumentGeneration">`) and the controller (Task 5, via the full `ITendersRepository`). `DocumentType`/`TemplateStatus` (Task 2) are consumed by `generateUndertaking` (Task 4) without modification.
- **No placeholders:** every step has complete, runnable code; the one explicit exception (Task 3 Step 5's note about docxtemplater's unresolved-tag behavior) is a deliberate "verify empirically, adjust the assertion" instruction — not a gap in the plan, since the exact library default is worth confirming by running the test rather than asserting it from documentation alone.
