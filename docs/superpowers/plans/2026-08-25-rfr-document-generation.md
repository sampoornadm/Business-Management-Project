# RFR Document Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a Request-for-Rates (RFR) document — business header, RFQ title/tender ref/due date, instructions, and the item list — as Word, Excel, and PDF, from one shared data shape, with an `instructions` field captured at RFQ and item level.

**Architecture:** All three formats are built from one pure data shape, `RfrDocumentData`, assembled once in `RfqService` from an existing `RfqDetail` plus a `Business` lookup. Excel extends the existing `quote-sheet.ts` (the absorption round-trip is untouched, just pushed down below a new header block). PDF is new, using `pdfkit` exactly as `reports.export.ts` already does. Word is new, using `docxtemplater` + `pizzip` (already a dependency, already used by `document-generation.service.ts`) against **one repo-bundled template** — not per-business — so it works with zero setup.

**Tech Stack:** Express + Prisma + PostgreSQL, Zod validation, Vitest with hand-written fake repositories, ExcelJS, pdfkit, docxtemplater + pizzip (all already dependencies), Next.js 15 + TanStack Query on the web.

**Spec:** `docs/superpowers/specs/2026-08-25-rfr-document-generation-design.md`

## Global Constraints

- Follow the backend module layout in `CLAUDE.md`: `*.repository.ts`, `*.service.ts` (constructor-injected repos, plain `new`), `*.controller.ts` (thin, `asyncHandler` + `sendSuccess`), `*.routes.ts` (`authenticateMiddleware` + `requirePermission` + `validate(zod)` + `@openapi` JSDoc).
- Tests are **Vitest, not Jest**. Unit tests use hand-written fake repositories implementing the `I<Name>Repository` interface — no mocking framework.
- No new RBAC permission keys — `rfq:read` / `rfq:create` / `rfq:update` already cover every route this plan adds.
- No new dependencies. `exceljs`, `pdfkit`, `pdf-parse`, `docxtemplater`, `pizzip` are already in `apps/server/package.json`.
- **ExcelJS column `key` lookups (`row.getCell("rate")`) only work in the same in-memory session that set `.columns` — a workbook reloaded from an uploaded file's bytes loses the key mapping and throws.** Verified empirically while writing this plan. `parseQuoteSheet` must read cells by **numeric position**, never by key, and the header/data row numbers must be named constants, not literals, since a new column shifts every position after it.
- The Word template lives at `apps/server/templates/rfr.docx`, generated once by a checked-in script (`apps/server/scripts/generate-rfr-template.ts`) and committed as a binary — it is not hand-edited in Word, and not per-business.
- `pnpm --filter @bmp/web dev|build|typecheck` all race on `apps/web/.next` — never run typecheck while the dev server is up.
- Integration tests need `docker compose up -d postgres redis minio minio-init mailhog` and migrations applied to `bmp_test`. Run `docker compose exec redis redis-cli FLUSHALL` first if logins start 429ing.

## File Structure

| File | Responsibility |
|---|---|
| `packages/database/prisma/schema.prisma` | `Rfq.instructions`, `RfqItem.instructions` |
| `packages/types/src/rfq.ts` | DTOs/inputs gain `instructions` |
| `apps/server/src/modules/rfq/rfq.repository.ts` | `CreateRfqData`/`CreateRfqItemData`/`UpdateRfqData` gain `instructions`; `create()` persists it |
| `apps/server/src/modules/rfq/rfq.validation.ts` | Zod schemas gain `instructions` |
| `apps/server/src/modules/rfq/rfq.mapper.ts` | DTO mappers pass `instructions` through |
| `apps/server/src/modules/rfq/rfq.controller.ts` | `create`/`update` pass `instructions`; two new download handlers |
| `apps/server/src/modules/rfq/rfq-document.ts` | **extended** — `RfrDocumentData` shape, `toRfrDocumentData`, `buildRfrPdf`, `buildRfrDocx` (alongside the existing `buildRfqText`) |
| `apps/server/src/modules/rfq/quote-sheet.ts` | **rewritten** — takes `RfrDocumentData`, writes a fixed business/RFQ header block above the existing item table, adds an Instructions column |
| `apps/server/src/modules/document-generation/document-generation.service.ts` | `formatDate` exported for reuse; `fillDocxTemplate`'s data type widened to accept arrays (loops) |
| `apps/server/scripts/generate-rfr-template.ts` | **new** — builds the bundled Word template's OOXML and writes `apps/server/templates/rfr.docx` |
| `apps/server/templates/rfr.docx` | **new, binary, committed** — the generated template |
| `apps/server/Dockerfile` | ship `apps/server/templates` in the production image |
| `apps/server/src/modules/rfq/rfq.service.ts` | `businessesRepository` injected; `loadRfrDocumentData`, `buildRfrPdfFor`, `buildRfrDocxFor`; `buildQuoteSheetFor` reworked to reuse the same loader |
| `apps/server/src/modules/rfq/rfq.routes.ts` | two new `GET` routes |
| `apps/server/src/modules/rfq/rfq.module.ts` | wires `businessesRepository` into `RfqService` |
| `apps/web/src/app/(dashboard)/rfqs/new/page.tsx` | instructions inputs, RFQ-level and per-item |
| `apps/web/src/components/rfq/quote-sheet-actions.tsx` | two more download buttons |

---

### Task 1: `instructions` field on Rfq/RfqItem — schema through API

**Files:**
- Modify: `packages/database/prisma/schema.prisma:773-819` (`Rfq`, `RfqItem`)
- Create: `packages/database/prisma/migrations/<generated>/migration.sql`
- Modify: `apps/server/src/modules/rfq/rfq.repository.ts` (`CreateRfqItemData`, `CreateRfqData`, `UpdateRfqData`, `create()`)
- Modify: `packages/types/src/rfq.ts` (`RfqItemDto`, `RfqDto`, `CreateRfqItemInput`, `CreateRfqInput`)
- Modify: `apps/server/src/modules/rfq/rfq.validation.ts` (`createRfqItemSchema`, `createRfqSchema`, `updateRfqSchema`)
- Modify: `apps/server/src/modules/rfq/rfq.mapper.ts` (`toItemDto`, `toRfqDto`)
- Modify: `apps/server/src/modules/rfq/rfq.controller.ts` (`create`, `update`)
- Modify: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts` (`FakeRfqRepository.create`)
- Test: `apps/server/src/modules/rfq/__tests__/rfq-quotes.integration.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Rfq.instructions: string | null`, `RfqItem.instructions: string | null`, and the same field name end-to-end through `CreateRfqInput.instructions?`, `CreateRfqItemInput.instructions?`, `RfqDto.instructions`, `RfqItemDto.instructions`.

- [ ] **Step 1: Edit the schema**

In `schema.prisma`, replace the `Rfq` model body with:

```prisma
model Rfq {
  id         String    @id @default(uuid())
  businessId String
  business   Business  @relation(fields: [businessId], references: [id], onDelete: Restrict)
  tenderId   String?
  tender     Tender?   @relation(fields: [tenderId], references: [id], onDelete: SetNull)
  title      String
  status     RfqStatus @default(DRAFT)
  dueDate    DateTime?

  // Shown once, above the item table, on every generated RFR document (Word/Excel/PDF) —
  // e.g. delivery or payment terms. Distinct from RfqItem.instructions (per line) and from
  // RfqQuote.remarks (the vendor's reply, the opposite direction).
  instructions String?

  awardedVendorId String?
  awardedVendor   Vendor? @relation("RfqAwardedVendor", fields: [awardedVendorId], references: [id], onDelete: SetNull)

  createdById String
  createdBy   User   @relation("RfqCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  items          RfqItem[]
  vendorInvites  RfqVendor[]
  purchaseOrders PurchaseOrder[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([businessId])
  @@index([tenderId])
  @@map("rfqs")
}
```

Replace the `RfqItem` model body with:

```prisma
model RfqItem {
  id          String  @id @default(uuid())
  rfqId       String
  rfq         Rfq     @relation(fields: [rfqId], references: [id], onDelete: Cascade)
  boqItemId   String?
  description String
  unit        String?
  quantity    Float
  sortOrder   Int     @default(0)

  // Per-line instruction on the generated RFR (e.g. "ISI marked only"). Set only when the
  // item is added — RfqItem has no update path today, so this follows description/unit/
  // quantity in being fixed at creation.
  instructions String?

  // Canonical item this line resolves to, for cross-tender price history. Nullable +
  // SetNull: the line still stands on its own if the Item is deleted, and unresolved
  // lines (itemId null) are picked up by the items module's converge-on-read backfill.
  itemId String?
  item   Item?   @relation(fields: [itemId], references: [id], onDelete: SetNull)

  quotes RfqQuote[]

  @@index([rfqId])
  @@index([itemId])
  @@map("rfq_items")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm db:migrate --name add_rfq_instructions`
Expected: `Your database is now in sync with your schema.` and a new folder under `packages/database/prisma/migrations/`.

- [ ] **Step 3: Apply to the test database**

```bash
cd packages/database && DATABASE_URL="postgresql://bmp:bmp_dev_password@localhost:5432/bmp_test?schema=public" pnpm exec prisma migrate deploy
```
Expected: `All migrations have been successfully applied.`

- [ ] **Step 4: Widen the repository types and `create()`**

In `rfq.repository.ts`:

```ts
export interface CreateRfqItemData {
  boqItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  instructions?: string | null;
  sortOrder?: number;
}

export interface CreateRfqData {
  title: string;
  tenderId?: string | null;
  businessId: string;
  dueDate?: Date | null;
  instructions?: string | null;
  createdById: string;
  items: CreateRfqItemData[];
}

export type UpdateRfqData = Partial<Pick<CreateRfqData, "title" | "dueDate" | "instructions">>;
```

In `create()`, add `instructions` to both Prisma calls:

```ts
  async create(data: CreateRfqData): Promise<string> {
    const rfqId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.rfq.create({
        data: {
          id: rfqId,
          title: data.title,
          tenderId: data.tenderId ?? null,
          businessId: data.businessId,
          dueDate: data.dueDate ?? null,
          instructions: data.instructions ?? null,
          createdById: data.createdById,
        },
      }),
      this.prisma.rfqItem.createMany({
        data: data.items.map((item, index) => ({
          id: randomUUID(),
          rfqId,
          boqItemId: item.boqItemId ?? null,
          description: item.description,
          unit: item.unit ?? null,
          quantity: item.quantity,
          instructions: item.instructions ?? null,
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return rfqId;
  }
```

`update()` is already generic (`this.prisma.rfq.update({ where: { id }, data })`) — no code change needed there, only the `UpdateRfqData` type above.

- [ ] **Step 5: Widen the shared types**

In `packages/types/src/rfq.ts`:

```ts
export interface RfqItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
  sortOrder: number;
  quotes: RfqQuoteDto[];
}
```

```ts
export interface RfqDto extends RfqListItemDto {
  instructions: string | null;
  items: RfqItemDto[];
  vendorInvites: RfqVendorInviteDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}
```

(`instructions` is RFQ-detail-only, like `items` — it does not go on `RfqListItemDto`.)

```ts
export interface CreateRfqItemInput {
  boqItemId?: string;
  description: string;
  unit?: string;
  quantity: number;
  instructions?: string;
  sortOrder?: number;
}

export interface CreateRfqInput {
  title: string;
  tenderId?: string;
  dueDate?: string;
  instructions?: string;
  items: CreateRfqItemInput[];
  vendorIds?: string[];
}

export type UpdateRfqInput = Partial<Pick<CreateRfqInput, "title" | "dueDate" | "instructions">>;
```

- [ ] **Step 6: Widen validation**

In `rfq.validation.ts`:

```ts
const createRfqItemSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  instructions: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
});

export const createRfqSchema = z.object({
  title: z.string().min(1).max(200),
  tenderId: z.string().uuid().optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  instructions: z.string().max(2000).optional(),
  items: z.array(createRfqItemSchema).min(1, "At least one RFQ item is required"),
  vendorIds: z.array(z.string().uuid()).optional(),
});
export type CreateRfqBody = z.infer<typeof createRfqSchema>;

export const updateRfqSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  dueDate: z.string().datetime().or(z.string().date()).optional(),
  instructions: z.string().max(2000).optional(),
});
export type UpdateRfqBody = z.infer<typeof updateRfqSchema>;
```

- [ ] **Step 7: Widen the mapper**

In `rfq.mapper.ts`:

```ts
function toItemDto(item: RfqItemDetail): RfqItemDto {
  return {
    id: item.id,
    boqItemId: item.boqItemId,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    instructions: item.instructions,
    sortOrder: item.sortOrder,
    quotes: item.quotes.map(toQuoteDto),
  };
}
```

```ts
export function toRfqDto(entity: RfqDetail): RfqDto {
  return {
    id: entity.id,
    title: entity.title,
    tenderId: entity.tenderId,
    status: entity.status,
    dueDate: entity.dueDate ? entity.dueDate.toISOString() : null,
    instructions: entity.instructions,
    awardedVendorId: entity.awardedVendorId,
    itemCount: entity.items.length,
    vendorCount: entity.vendorInvites.length,
    items: entity.items.map(toItemDto),
    vendorInvites: entity.vendorInvites.map(toVendorInviteDto),
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
```

(`RfqDetail`/`RfqItemDetail` pick up `instructions` automatically — `rfqDetailArgs` uses Prisma `include`, not `select`, so every new scalar column already flows through without touching that file.)

- [ ] **Step 8: Pass it through the controller**

In `rfq.controller.ts`:

```ts
  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateRfqBody;
    const rfq = await this.rfqService.create(
      {
        title: body.title,
        tenderId: body.tenderId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        instructions: body.instructions,
        items: body.items,
        vendorIds: body.vendorIds,
      },
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, rfq, "RFQ created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateRfqBody;
    const rfq = await this.rfqService.update(
      req.params.id!,
      {
        title: body.title,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        instructions: body.instructions,
      },
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "RFQ updated");
  });
```

- [ ] **Step 9: Keep the fake repository honest**

In `rfq.service.spec.ts`, `FakeRfqRepository.create()` — add `instructions` to both the RFQ and each item so future tests can assert on it:

```ts
  async create(data: CreateRfqData) {
    const id = randomUUID();
    const rfq: RfqDetail = {
      id,
      title: data.title,
      tenderId: data.tenderId ?? null,
      status: "DRAFT",
      dueDate: data.dueDate ?? null,
      instructions: data.instructions ?? null,
      awardedVendorId: null,
      createdById: data.createdById,
      createdBy: CREATOR,
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        rfqId: id,
        boqItemId: item.boqItemId ?? null,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        instructions: item.instructions ?? null,
        sortOrder: item.sortOrder ?? index,
        quotes: [],
      })),
      vendorInvites: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as RfqDetail;
    this.rfqs.set(id, rfq);
    return id;
  }
```

- [ ] **Step 10: Write the failing integration test**

In `rfq-quotes.integration.spec.ts`, widen the `beforeAll`'s RFQ-creation POST and add a new `it` right after it:

```ts
    const created = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Quote Sheet Integration RFQ",
        instructions: "Deliver to the site office, weekday mornings only",
        items: [
          { description: "XLPE Cable 4C x16", unit: "m", quantity: 100, instructions: "ISI marked only" },
          { description: "XLPE Cable 4C x25", unit: "m", quantity: 50 },
        ],
        vendorIds: [vendorId],
      });
```

```ts
  it("round-trips RFQ-level and per-item instructions", async () => {
    const response = await request(app)
      .get(`/api/v1/rfqs/${rfqId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.body.data.instructions).toBe("Deliver to the site office, weekday mornings only");
    expect(response.body.data.items[0].instructions).toBe("ISI marked only");
    expect(response.body.data.items[1].instructions).toBeNull();
  });
```

- [ ] **Step 11: Run it and watch it fail, then pass**

Run: `docker compose exec redis redis-cli FLUSHALL && cd apps/server && pnpm vitest run rfq-quotes.integration`
Expected: FAIL first (`instructions` doesn't exist on the response) if run before Steps 4-8, PASS after.

- [ ] **Step 12: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

- [ ] **Step 13: Commit**

```bash
git add packages/database/prisma packages/types/src/rfq.ts apps/server/src/modules/rfq
git commit -m "feat(rfq): add RFQ-level and per-item instructions fields"
```

---

### Task 2: `RfrDocumentData` shape + PDF renderer

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq-document.ts` (add `RfrDocumentData`, `toRfrDocumentData`, `buildRfrPdf`)
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts` (export `formatDate`)
- Test: `apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts`

**Interfaces:**
- Consumes: `formatDate(date: Date): string` (widened export from `document-generation.service.ts`).
- Produces:

```ts
export interface RfrDocumentItem {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  rfqTitle: string;
  tenderNumber: string | null;
  dueDate: string | null;
  instructions: string | null;
  items: RfrDocumentItem[];
}

export interface RfrSourceItem {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrSourceRfq {
  title: string;
  instructions: string | null;
  dueDate: Date | null;
  items: RfrSourceItem[];
}

export function toRfrDocumentData(
  rfq: RfrSourceRfq,
  business: { name: string; address: string | null; gstNumber: string | null },
  tenderNumber: string | null,
): RfrDocumentData;

export function buildRfrPdf(data: RfrDocumentData): Promise<Buffer>;
```

`RfrSourceRfq`/`RfrSourceItem` are deliberately narrower than `RfqDetail`/`RfqItemDetail` (Task 4 passes a real `RfqDetail`, which is structurally compatible — it just has more fields than this function needs) so this function is unit-testable with plain object literals, no Prisma types required.

- [ ] **Step 1: Export `formatDate`**

In `document-generation.service.ts`, add `export` to the existing function (no other change):

```ts
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `rfq-document.spec.ts`:

```ts
import { buildRfrPdf, buildRfqText, toRfrDocumentData } from "../rfq-document.js";
import pdfParse from "pdf-parse";

describe("toRfrDocumentData", () => {
  it("shapes business, RFQ and item data into one document payload", () => {
    const data = toRfrDocumentData(
      {
        title: "Cement Supply RFQ",
        instructions: "Deliver to site within 15 days",
        dueDate: new Date("2026-09-01"),
        items: [
          { id: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: "ISI marked only" },
          { id: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
        ],
      },
      { name: "Archie Udyog", address: "Pune, MH", gstNumber: "27AAAAA0000A1Z5" },
      "TND-0001",
    );

    expect(data).toEqual({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
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

  it("carries nulls through when there is no tender, due date or instructions", () => {
    const data = toRfrDocumentData(
      { title: "Standalone RFQ", instructions: null, dueDate: null, items: [] },
      { name: "Archie Udyog", address: null, gstNumber: null },
      null,
    );

    expect(data.tenderNumber).toBeNull();
    expect(data.dueDate).toBeNull();
    expect(data.instructions).toBeNull();
  });
});

describe("buildRfrPdf", () => {
  it("renders business header, RFQ title, instructions and every item into the PDF text", async () => {
    const buffer = await buildRfrPdf({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
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

    const { text } = await pdfParse(buffer);
    expect(text).toContain("Archie Udyog");
    expect(text).toContain("Cement Supply RFQ");
    expect(text).toContain("TND-0001");
    expect(text).toContain("Deliver to site within 15 days");
    expect(text).toContain("OPC Cement");
    expect(text).toContain("ISI marked only");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run rfq-document.spec.ts`
Expected: FAIL — `toRfrDocumentData`/`buildRfrPdf` don't exist yet.

- [ ] **Step 4: Implement**

Add to the top of `rfq-document.ts`:

```ts
import PDFDocument from "pdfkit";

import { formatDate } from "../document-generation/document-generation.service.js";
```

Add after the existing `buildRfqText`:

```ts
export interface RfrDocumentItem {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  rfqTitle: string;
  tenderNumber: string | null;
  dueDate: string | null;
  instructions: string | null;
  items: RfrDocumentItem[];
}

export interface RfrSourceItem {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrSourceRfq {
  title: string;
  instructions: string | null;
  dueDate: Date | null;
  items: RfrSourceItem[];
}

export function toRfrDocumentData(
  rfq: RfrSourceRfq,
  business: { name: string; address: string | null; gstNumber: string | null },
  tenderNumber: string | null,
): RfrDocumentData {
  return {
    businessName: business.name,
    businessAddress: business.address,
    businessGstNumber: business.gstNumber,
    rfqTitle: rfq.title,
    tenderNumber,
    dueDate: rfq.dueDate ? formatDate(rfq.dueDate) : null,
    instructions: rfq.instructions,
    items: rfq.items.map((item) => ({
      rfqItemId: item.id,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      instructions: item.instructions,
    })),
  };
}

const RFR_COLUMN_HEADERS = [
  "Description",
  "Unit",
  "Qty",
  "Instructions",
  "Rate",
  "Make",
  "Model",
  "Regret (Y/N)",
  "Remarks",
];
const RFR_COLUMN_WIDTHS = [130, 35, 35, 75, 45, 50, 50, 35, 60];

export function buildRfrPdf(data: RfrDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(data.businessName, { align: "center" });
    const addressLine = [
      data.businessAddress,
      data.businessGstNumber ? `GSTIN: ${data.businessGstNumber}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    if (addressLine) {
      doc.fontSize(9).font("Helvetica").text(addressLine, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text(`Request for Rates: ${data.rfqTitle}`);
    const metaLine = [
      data.tenderNumber ? `Tender Ref: ${data.tenderNumber}` : null,
      data.dueDate ? `Due Date: ${data.dueDate}` : null,
    ]
      .filter(Boolean)
      .join("   ");
    if (metaLine) doc.fontSize(9).font("Helvetica").text(metaLine);
    if (data.instructions) doc.fontSize(9).font("Helvetica").text(`Instructions: ${data.instructions}`);
    doc.moveDown();

    let y = doc.y;
    function columnX(index: number): number {
      return startX + RFR_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }

    function drawRow(values: string[], bold: boolean) {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, { width: RFR_COLUMN_WIDTHS[index]! });
      });
      y += 18;
    }

    drawRow(RFR_COLUMN_HEADERS, true);
    const tableWidth = RFR_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 4;

    for (const item of data.items) {
      drawRow(
        [item.description, item.unit ?? "", String(item.quantity), item.instructions ?? "", "", "", "", "", ""],
        false,
      );
    }

    doc.end();
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/server && pnpm vitest run rfq-document.spec.ts`
Expected: all pass, including the pre-existing `buildRfqText` tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/rfq/rfq-document.ts apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts apps/server/src/modules/document-generation/document-generation.service.ts
git commit -m "feat(rfq): add RfrDocumentData shape and PDF request-for-rates renderer"
```

---

### Task 3: Word renderer + bundled template

This is the highest-risk task: the template's OOXML table uses docxtemplater's row-loop
technique (`{{#items}}` in the first cell of a row, `{{/items}}` in the last cell of the
*same* row), hand-authored rather than built in Word. The test in Step 3 is the real proof
that it works — do not skip running it.

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts` (widen `fillDocxTemplate`'s data type)
- Create: `apps/server/scripts/generate-rfr-template.ts`
- Create: `apps/server/templates/rfr.docx` (binary, generated by the script, committed)
- Modify: `apps/server/src/modules/rfq/rfq-document.ts` (add `buildRfrDocx`)
- Modify: `apps/server/Dockerfile` (ship `apps/server/templates` in the production image)
- Test: `apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts`

**Interfaces:**
- Consumes: `RfrDocumentData` (Task 2), `fillDocxTemplate(templateBuffer: Buffer, data: Record<string, unknown>): Buffer`.
- Produces: `buildRfrDocx(data: RfrDocumentData): Promise<Buffer>`.

- [ ] **Step 1: Widen `fillDocxTemplate`'s type**

In `document-generation.service.ts`, change the signature only — the body is unchanged since docxtemplater's `.render()` already accepts arbitrary nested data at runtime, only the TS type was narrower than needed:

```ts
export function fillDocxTemplate(templateBuffer: Buffer, data: Record<string, unknown>): Buffer {
```

- [ ] **Step 2: Write the generator script**

Create `apps/server/scripts/generate-rfr-template.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PizZip from "pizzip";

// Builds the bundled Word template docxtemplater fills at request time. Not hand-edited in
// Word — re-run this script (`pnpm --filter @bmp/server exec tsx scripts/generate-rfr-template.ts`)
// after changing the layout below, and commit the regenerated apps/server/templates/rfr.docx.

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(currentDir, "..", "templates", "rfr.docx");

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

function paragraph(text: string, opts: { bold?: boolean; center?: boolean } = {}): string {
  const pPr = opts.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : "";
  const rPr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function cell(text: string, opts: { bold?: boolean } = {}): string {
  const rPr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:tc><w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
}

const HEADERS = ["Description", "Unit", "Qty", "Instructions", "Rate", "Make", "Model", "Regret (Y/N)", "Remarks"];
const headerRow = `<w:tr>${HEADERS.map((h) => cell(h, { bold: true })).join("")}</w:tr>`;

// The loop row: {{#items}} opens in the first cell, {{/items}} closes in the last cell of
// THIS SAME row. docxtemplater repeats the whole <w:tr> once per array element and resolves
// {{description}}/{{unit}}/{{quantity}}/{{instructions}} against each item's own fields.
// Rate/Make/Model/Regret/Remarks are left blank for the vendor to fill in by hand.
const loopRowCells = [
  cell("{{#items}}{{description}}"),
  cell("{{unit}}"),
  cell("{{quantity}}"),
  cell("{{instructions}}"),
  cell(""),
  cell(""),
  cell(""),
  cell(""),
  cell("{{/items}}"),
];
const loopRow = `<w:tr>${loopRowCells.join("")}</w:tr>`;

const tableBorders =
  "<w:tblBorders>" +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  "</w:tblBorders>";
const tblGrid = `<w:tblGrid>${HEADERS.map(() => "<w:gridCol/>").join("")}</w:tblGrid>`;
const table = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${tableBorders}</w:tblPr>${tblGrid}${headerRow}${loopRow}</w:tbl>`;

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:body>" +
  paragraph("{{businessName}}", { bold: true, center: true }) +
  paragraph("{{businessAddress}}", { center: true }) +
  paragraph("GSTIN: {{businessGstNumber}}", { center: true }) +
  "<w:p/>" +
  paragraph("Request for Rates: {{rfqTitle}}", { bold: true }) +
  paragraph("Tender Ref: {{tenderNumber}}     Due Date: {{dueDate}}") +
  paragraph("Instructions: {{instructions}}") +
  "<w:p/>" +
  table +
  "<w:p/>" +
  "</w:body>" +
  "</w:document>";

async function main() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", DOCUMENT_XML);
  const buffer = zip.generate({ type: "nodebuffer" });
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, buffer);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
```

- [ ] **Step 3: Run the generator, and prove the loop works before wiring anything else up**

Run: `cd apps/server && pnpm exec tsx scripts/generate-rfr-template.ts`
Expected: `Wrote .../apps/server/templates/rfr.docx`.

Now write the failing test for `buildRfrDocx` (Step 4 implements it), append to `rfq-document.spec.ts`:

```ts
import { buildRfrDocx } from "../rfq-document.js";
import PizZip from "pizzip";

describe("buildRfrDocx", () => {
  it("fills the bundled template with business, RFQ and item data", async () => {
    const buffer = await buildRfrDocx({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
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

    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).toContain("Archie Udyog");
    expect(documentXml).toContain("Cement Supply RFQ");
    expect(documentXml).toContain("TND-0001");
    expect(documentXml).toContain("Deliver to site within 15 days");
    expect(documentXml).toContain("OPC Cement");
    expect(documentXml).toContain("ISI marked only");
    expect(documentXml).toContain("TMT Bars");
    expect(documentXml).not.toContain("{{#items}}");
    expect(documentXml).not.toContain("{{/items}}");
    // Two items in the loop must produce two separate table rows, not one merged row.
    expect(documentXml.split("OPC Cement")).toHaveLength(2);
    expect(documentXml.split("TMT Bars")).toHaveLength(2);
  });
});
```

Run: `cd apps/server && pnpm vitest run rfq-document.spec.ts -t "buildRfrDocx"`
Expected: FAIL — `buildRfrDocx` doesn't exist yet.

- [ ] **Step 4: Implement `buildRfrDocx`**

Add to the top of `rfq-document.ts` (alongside the imports from Task 2):

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fillDocxTemplate, formatDate } from "../document-generation/document-generation.service.js";

// Resolves to apps/server regardless of whether this runs from src (tsx, dev) or dist
// (compiled, prod) — both live two levels under apps/server/src/modules/rfq. Same technique
// as apps/server/src/docs/swagger.ts.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const RFR_TEMPLATE_PATH = path.join(currentDir, "../../../templates/rfr.docx");
```

Add after `buildRfrPdf`:

```ts
export async function buildRfrDocx(data: RfrDocumentData): Promise<Buffer> {
  const templateBuffer = await readFile(RFR_TEMPLATE_PATH);
  return fillDocxTemplate(templateBuffer, {
    businessName: data.businessName,
    businessAddress: data.businessAddress ?? "",
    businessGstNumber: data.businessGstNumber ?? "",
    rfqTitle: data.rfqTitle,
    tenderNumber: data.tenderNumber ?? "",
    dueDate: data.dueDate ?? "",
    instructions: data.instructions ?? "",
    items: data.items.map((item) => ({
      description: item.description,
      unit: item.unit ?? "",
      quantity: String(item.quantity),
      instructions: item.instructions ?? "",
    })),
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/server && pnpm vitest run rfq-document.spec.ts`
Expected: all pass. If the loop assertions fail, the problem is in the hand-authored XML in
Step 2 (most likely: `{{#items}}`/`{{/items}}` not both inside the same `<w:tr>`, or a stray
unescaped character) — fix the script, re-run Step 3, and re-run this test; do not weaken the
assertions to make it pass.

- [ ] **Step 6: Ship the template in the production image**

In `apps/server/Dockerfile`, in the `runner` stage, add one line after the `src` copy:

```dockerfile
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/server/templates ./apps/server/templates
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
```

Without this, `docker compose up` / production deploys copy `dist` and `src` but not
`templates` — `buildRfrDocx` would 404-equivalent (`ENOENT`) in a container even though it
works in local dev, since `pnpm dev` runs straight from the source tree.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add apps/server/scripts/generate-rfr-template.ts apps/server/templates/rfr.docx apps/server/src/modules/rfq/rfq-document.ts apps/server/src/modules/rfq/__tests__/rfq-document.spec.ts apps/server/src/modules/document-generation/document-generation.service.ts apps/server/Dockerfile
git commit -m "feat(rfq): add Word request-for-rates renderer with a bundled template"
```

---

### Task 4: Download routes — PDF and Word

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts` (`businessesRepository` injected; `loadRfrDocumentData`, `buildRfrPdfFor`, `buildRfrDocxFor`)
- Modify: `apps/server/src/modules/rfq/rfq.controller.ts` (`downloadRfrPdf`, `downloadRfrWord`)
- Modify: `apps/server/src/modules/rfq/rfq.routes.ts` (two `GET` routes)
- Modify: `apps/server/src/modules/rfq/rfq.module.ts` (wire `businessesRepository`)
- Modify: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts` (`FakeBusinessesRepository`, constructor call, two new tests)
- Test: `apps/server/src/modules/rfq/__tests__/rfq-quotes.integration.spec.ts`

**Interfaces:**
- Consumes: `toRfrDocumentData`, `buildRfrPdf`, `buildRfrDocx` (Tasks 2-3); `IBusinessesRepository.findById(id: string)` (existing, `apps/server/src/modules/businesses/businesses.repository.ts`).
- Produces: `RfqService.buildRfrPdfFor(rfqId, businessId): Promise<{ filename: string; buffer: Buffer }>`, `RfqService.buildRfrDocxFor(rfqId, businessId): Promise<{ filename: string; buffer: Buffer }>`, `GET /rfqs/:id/documents/pdf`, `GET /rfqs/:id/documents/word`.

- [ ] **Step 1: Write the failing unit tests**

In `rfq.service.spec.ts`, add a fake alongside the other `Fake*Repository` classes:

```ts
class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  businesses = new Map<string, { name: string; address: string | null; gstNumber: string | null }>();

  async findById(id: string) {
    return (this.businesses.get(id) ?? null) as never;
  }
}
```

Add the import at the top: `import type { IBusinessesRepository } from "../../businesses/businesses.repository.js";`

In the `describe("RfqService")` block, declare and construct it alongside the others:

```ts
  let businessesRepository: FakeBusinessesRepository;
  ...
  beforeEach(() => {
    ...
    businessesRepository = new FakeBusinessesRepository();
    ...
    service = new RfqService(
      repository as unknown as IRfqRepository,
      tendersRepository as unknown as ITendersRepository,
      vendorsRepository as unknown as IVendorsRepository,
      boqRepository as unknown as IBoqRepository,
      usersRepository as unknown as IUsersRepository,
      businessesRepository as unknown as IBusinessesRepository,
      emailService as unknown as EmailService,
      auditService,
    );
  });
```

Add the tests:

```ts
  it("builds a PDF request-for-rates document for an existing RFQ", async () => {
    businessesRepository.businesses.set(businessId, { name: "Archie Udyog", address: null, gstNumber: null });
    const rfq = await createBasicRfq();

    const { filename, buffer } = await service.buildRfrPdfFor(rfq.id, businessId);

    expect(filename).toMatch(/\.pdf$/);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("throws NotFoundError when the business record is missing", async () => {
    const rfq = await createBasicRfq();

    await expect(service.buildRfrPdfFor(rfq.id, businessId)).rejects.toThrow(NotFoundError);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run rfq.service.spec.ts -t "request-for-rates"`
Expected: FAIL — `buildRfrPdfFor` doesn't exist, and the constructor call has too many arguments.

- [ ] **Step 3: Wire `businessesRepository` into `RfqService` and add the loader**

In `rfq.service.ts`, widen the import from `./rfq-document.js` and add the new import:

```ts
import { buildRfrDocx, buildRfrPdf, buildRfqText, toRfrDocumentData } from "./rfq-document.js";
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";
```

Add the constructor param (after `usersRepository`, before `emailService`):

```ts
  constructor(
    private readonly rfqRepository: IRfqRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly vendorsRepository: IVendorsRepository,
    private readonly boqRepository: IBoqRepository,
    private readonly usersRepository: IUsersRepository,
    private readonly businessesRepository: IBusinessesRepository,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}
```

Add the loader and the two new public methods (near `buildQuoteSheetFor`):

```ts
  private async loadRfrDocumentData(rfqId: string, businessId: string) {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const business = await this.businessesRepository.findById(businessId);
    if (!business) throw new NotFoundError("Business not found");

    let tenderNumber: string | null = null;
    if (rfq.tenderId) {
      const tender = await this.tendersRepository.findById(rfq.tenderId, businessId);
      tenderNumber = tender?.tenderNumber ?? null;
    }

    const data = toRfrDocumentData(rfq, business, tenderNumber);
    const safeTitle = rfq.title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60);
    return { data, safeTitle };
  }

  async buildRfrPdfFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildRfrPdf(data);
    return { filename: `RFR-${safeTitle || rfqId}.pdf`, buffer };
  }

  async buildRfrDocxFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildRfrDocx(data);
    return { filename: `RFR-${safeTitle || rfqId}.docx`, buffer };
  }
```

(`buildQuoteSheetFor` itself is reworked in Task 5, once `quote-sheet.ts` accepts `RfrDocumentData` — leave it as-is here.)

- [ ] **Step 4: Wire the module**

In `rfq.module.ts`:

```ts
import { businessesRepository } from "../businesses/businesses.module.js";
...
export const rfqService = new RfqService(
  rfqRepository,
  tendersRepository,
  vendorsRepository,
  boqRepository,
  usersRepository,
  businessesRepository,
  emailService,
  auditService,
);
```

- [ ] **Step 5: Add the controller handlers**

In `rfq.controller.ts`, next to `downloadQuoteSheet`:

```ts
  downloadRfrPdf = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildRfrPdfFor(req.params.id!, req.user!.businessId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  downloadRfrWord = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildRfrDocxFor(req.params.id!, req.user!.businessId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });
```

- [ ] **Step 6: Add the routes**

In `rfq.routes.ts`, right after the `/:id/quote-sheet` route block:

```ts
  /**
   * @openapi
   * /rfqs/{id}/documents/pdf:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a Request-for-Rates PDF for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: pdf file }
   */
  router.get(
    "/:id/documents/pdf",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadRfrPdf,
  );

  /**
   * @openapi
   * /rfqs/{id}/documents/word:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a Request-for-Rates Word document for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: docx file }
   */
  router.get(
    "/:id/documents/word",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadRfrWord,
  );
```

- [ ] **Step 7: Run the unit tests**

Run: `cd apps/server && pnpm vitest run rfq.service.spec.ts`
Expected: all pass, including the two new ones.

- [ ] **Step 8: Write the failing integration test**

In `rfq-quotes.integration.spec.ts`, add after the existing quote-sheet test:

```ts
  it("downloads a PDF request-for-rates document", async () => {
    const response = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/documents/pdf`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("downloads a Word request-for-rates document", async () => {
    const response = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/documents/word`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.body.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 9: Run everything**

Run: `docker compose exec redis redis-cli FLUSHALL && cd apps/server && pnpm vitest run rfq`
Expected: unit + integration rfq tests pass.

- [ ] **Step 10: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/modules/rfq apps/server/src/modules/rfq/__tests__
git commit -m "feat(rfq): add PDF and Word request-for-rates download routes"
```

---

### Task 5: Excel — business/instructions header block + Instructions column

**Files:**
- Modify: `apps/server/src/modules/rfq/quote-sheet.ts` (full rewrite)
- Modify: `apps/server/src/modules/rfq/rfq.service.ts` (`buildQuoteSheetFor`)
- Modify: `apps/server/src/modules/rfq/__tests__/quote-sheet.spec.ts`
- Modify: `apps/server/src/modules/rfq/__tests__/rfq-quotes.integration.spec.ts`

**Interfaces:**
- Consumes: `RfrDocumentData` (Task 2), `loadRfrDocumentData` (Task 4).
- Produces: `buildQuoteSheet(data: RfrDocumentData): Promise<Buffer>` (signature change — was `(rfqTitle: string, rows: QuoteSheetRow[])`), `export const ITEM_TABLE_HEADER_ROW = 6`.

**Verified while writing this plan:** an ExcelJS workbook reloaded from bytes (`workbook.xlsx.load(buffer)`) does **not** retain the column `key` mapping set at write time — `row.getCell("someKey")` throws `Out of bounds` on a freshly-loaded workbook. `parseQuoteSheet` must keep reading cells by **numeric position**. Row numbers, unlike column keys, **do** survive a save/load round-trip — confirmed by writing a business-header-then-table sheet, saving, reloading, and reading rows back by number.

- [ ] **Step 1: Write the failing tests**

Replace `quote-sheet.spec.ts` in full:

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { RfrDocumentData } from "../rfq-document.js";
import { buildQuoteSheet, ITEM_TABLE_HEADER_ROW, parseQuoteSheet } from "../quote-sheet.js";

const DATA: RfrDocumentData = {
  businessName: "Archie Udyog",
  businessAddress: "Pune, MH",
  businessGstNumber: "27AAAAA0000A1Z5",
  rfqTitle: "RFQ-1",
  tenderNumber: null,
  dueDate: null,
  instructions: null,
  items: [
    { rfqItemId: "item-1", description: "XLPE Cable 4C x16", unit: "m", quantity: 100, instructions: null },
    { rfqItemId: "item-2", description: "XLPE Cable 4C x25", unit: "m", quantity: 50, instructions: null },
  ],
};

const FIRST_ITEM_ROW = ITEM_TABLE_HEADER_ROW + 1;

// Column letters, fixed regardless of the business-header rows above: A=rfqItemId (hidden),
// B=Item Code, C=Description, D=Unit, E=Qty, F=Instructions, G=Rate, H=Make, I=Model,
// J=Regret, K=Remarks. Data starts at ITEM_TABLE_HEADER_ROW + 1.
async function fill(edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteSheet(DATA));
  edit(wb.worksheets[0]!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("quote sheet", () => {
  it("round-trips a filled rate with make and model", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 152.5;
      sheet.getCell(`H${FIRST_ITEM_ROW}`).value = "Polycab";
      sheet.getCell(`I${FIRST_ITEM_ROW}`).value = "FRLS-16";
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rfqItemId: "item-1",
      rate: 152.5,
      regretted: false,
      make: "Polycab",
      model: "FRLS-16",
    });
  });

  it("reads Regret=Y as a regret with no rate, ignoring any rate in the row", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 999; // must be ignored
      sheet.getCell(`J${FIRST_ITEM_ROW}`).value = "Y";
    });

    const { rows } = await parseQuoteSheet(buffer);

    expect(rows[0]).toMatchObject({ rfqItemId: "item-1", rate: null, regretted: true });
  });

  it("skips an untouched row rather than storing it as a rate of 0", async () => {
    const { rows, errors } = await parseQuoteSheet(await fill(() => {}));

    expect(rows).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("reports an unknown rfqItemId instead of guessing which item it meant", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell(`A${FIRST_ITEM_ROW}`).value = "";
      sheet.getCell(`G${FIRST_ITEM_ROW}`).value = 10;
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(rows).toEqual([]);
    expect(errors[0]).toContain(`row ${FIRST_ITEM_ROW}`);
  });

  it("builds a sheet for an RFQ title containing characters Excel forbids", async () => {
    // Real titles come from tender titles, e.g. "MJ/C06/2025/2395-PU TUBE". ExcelJS throws
    // on : \ / ? * [ ] in a sheet name rather than sanitising it.
    const buffer = await buildQuoteSheet({ ...DATA, rfqTitle: "MJ/C06/2025/2395-PU TUBE [rev2]" });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const name = wb.worksheets[0]!.name;

    expect(name).not.toMatch(/[:\\/?*[\]]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it("writes the business header and instructions above the item table", async () => {
    const buffer = await buildQuoteSheet({
      ...DATA,
      instructions: "Deliver within 15 days",
      tenderNumber: "TND-0001",
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.worksheets[0]!;

    expect(sheet.getCell("A1").value).toBe("Archie Udyog");
    expect(String(sheet.getCell("A3").value)).toContain("TND-0001");
    expect(String(sheet.getCell("A4").value)).toContain("Deliver within 15 days");
    expect(sheet.getCell(`A${ITEM_TABLE_HEADER_ROW}`).value).toBe("rfqItemId");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run quote-sheet.spec.ts`
Expected: FAIL — `buildQuoteSheet` still takes two args, `ITEM_TABLE_HEADER_ROW` doesn't exist.

- [ ] **Step 3: Rewrite `quote-sheet.ts`**

```ts
import ExcelJS from "exceljs";

import type { RfrDocumentData } from "./rfq-document.js";

/**
 * Column layout. Export and import MUST agree, which is why both live in this file.
 * Column A holds the rfqItemId and is hidden: rows are matched back by id, never by
 * description. Descriptions run 140-180 chars and vendors edit them freely, so any
 * text-based match would silently attach a rate to the wrong item.
 */
const COLUMNS = [
  { header: "rfqItemId", key: "rfqItemId", width: 38 },
  { header: "Item Code", key: "itemCode", width: 16 },
  { header: "Description", key: "description", width: 60 },
  { header: "Unit", key: "unit", width: 10 },
  { header: "Qty", key: "quantity", width: 10 },
  { header: "Instructions", key: "instructions", width: 30 },
  { header: "Rate", key: "rate", width: 14 },
  { header: "Make", key: "make", width: 18 },
  { header: "Model", key: "model", width: 18 },
  { header: "Regret (Y/N)", key: "regret", width: 14 },
  { header: "Remarks", key: "remarks", width: 30 },
] as const;

// A fixed-size business/RFQ header block above the item table, so the number of rows to
// skip on import never depends on which fields happen to be present — an RFQ with no
// instructions still reserves the row, just blank.
const BUSINESS_NAME_ROW = 1;
const BUSINESS_ADDRESS_ROW = 2;
const RFQ_META_ROW = 3;
const INSTRUCTIONS_ROW = 4;
// Row 5 is a blank spacer.
export const ITEM_TABLE_HEADER_ROW = 6;
const FIRST_ITEM_ROW = ITEM_TABLE_HEADER_ROW + 1;

// Column positions (1-based). parseQuoteSheet reads by number, not by ExcelJS column key —
// a workbook reloaded from bytes (the vendor's filled-in upload) does not retain the key
// mapping set at write time, only genuine column position and row number.
const COL_RFQ_ITEM_ID = 1;
const COL_RATE = 7;
const COL_MAKE = 8;
const COL_MODEL = 9;
const COL_REGRET = 10;
const COL_REMARKS = 11;

export interface ParsedQuoteRow {
  rfqItemId: string;
  rate: number | null;
  regretted: boolean;
  make?: string;
  model?: string;
  remarks?: string;
}

export interface ParsedQuoteSheet {
  rows: ParsedQuoteRow[];
  errors: string[];
}

/**
 * Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars; ExcelJS throws
 * rather than sanitising. RFQ titles here derive from tender titles like
 * "MJ/C06/2025/2395-PU TUBE", so passing one through unfiltered is a crash, not an edge case.
 */
function toSheetName(title: string): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31);
  return cleaned || "Quotes";
}

export async function buildQuoteSheet(data: RfrDocumentData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(toSheetName(data.rfqTitle));
  sheet.columns = COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  const nameRow = sheet.addRow([data.businessName]);
  nameRow.font = { bold: true, size: 14 };

  const addressLine = [
    data.businessAddress,
    data.businessGstNumber ? `GSTIN: ${data.businessGstNumber}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  sheet.addRow([addressLine]);

  const metaLine = [
    `RFQ: ${data.rfqTitle}`,
    data.tenderNumber ? `Tender Ref: ${data.tenderNumber}` : null,
    data.dueDate ? `Due Date: ${data.dueDate}` : null,
  ]
    .filter(Boolean)
    .join("   ");
  sheet.addRow([metaLine]);

  sheet.addRow([data.instructions ? `Instructions: ${data.instructions}` : ""]);
  sheet.addRow([]); // spacer

  for (const row of [BUSINESS_NAME_ROW, BUSINESS_ADDRESS_ROW, RFQ_META_ROW, INSTRUCTIONS_ROW]) {
    sheet.mergeCells(row, 1, row, COLUMNS.length);
  }

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.font = { bold: true };

  for (const item of data.items) {
    sheet.addRow({
      rfqItemId: item.rfqItemId,
      description: item.description,
      unit: item.unit ?? "",
      quantity: item.quantity,
      instructions: item.instructions ?? "",
    });
  }

  sheet.getColumn("rfqItemId").hidden = true;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function text(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value).trim();
}

export async function parseQuoteSheet(buffer: Buffer): Promise<ParsedQuoteSheet> {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS's load() types its param as its own Buffer; a Node Buffer clashes under the
  // repo's @types/node. Same cast boq.parser.ts / vendor-item-tags.parser.ts use.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: ["The workbook has no sheets"] };

  const rows: ParsedQuoteRow[] = [];
  const errors: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= ITEM_TABLE_HEADER_ROW) return;

    const rfqItemId = text(row.getCell(COL_RFQ_ITEM_ID));
    const rateText = text(row.getCell(COL_RATE));
    const regretted = text(row.getCell(COL_REGRET)).toUpperCase().startsWith("Y");

    // An untouched row is not an answer. Storing it would be inventing a rate of 0.
    if (!regretted && rateText === "") return;

    if (!rfqItemId) {
      errors.push(`row ${rowNumber}: missing rfqItemId — do not delete or reorder column A`);
      return;
    }

    let rate: number | null = null;
    if (!regretted) {
      const parsed = Number(rateText);
      if (Number.isNaN(parsed) || parsed < 0) {
        errors.push(`row ${rowNumber}: "${rateText}" is not a valid rate`);
        return;
      }
      rate = parsed;
    }

    const make = text(row.getCell(COL_MAKE));
    const model = text(row.getCell(COL_MODEL));
    const remarks = text(row.getCell(COL_REMARKS));

    rows.push({
      rfqItemId,
      rate,
      regretted,
      ...(make ? { make } : {}),
      ...(model ? { model } : {}),
      ...(remarks ? { remarks } : {}),
    });
  });

  return { rows, errors };
}
```

- [ ] **Step 4: Update `buildQuoteSheetFor` to reuse the shared loader**

In `rfq.service.ts`:

```ts
  async buildQuoteSheetFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildQuoteSheet(data);
    return { filename: `quotes-${safeTitle || rfqId}.xlsx`, buffer };
  }
```

Update the import from `./quote-sheet.js` — it still imports `buildQuoteSheet` and
`parseQuoteSheet`, just no longer needs a separate row-shape type.

- [ ] **Step 5: Run the unit tests**

Run: `cd apps/server && pnpm vitest run quote-sheet.spec.ts rfq.service.spec.ts`
Expected: all pass.

- [ ] **Step 6: Update the integration test's cell references**

In `rfq-quotes.integration.spec.ts`, the existing "exports a quote sheet and imports it back"
test hardcodes `F2`/`I2`/`I3` — shift both the row (business header now occupies rows 1-5) and
the column (the new Instructions column shifts everything after it by one letter):

```ts
    ws.getCell("G7").value = 152.5; // Rate for the first item
    ws.getCell("J7").value = "N";
    ws.getCell("J8").value = "Y"; // Second item: regret
```

- [ ] **Step 7: Run everything**

Run: `docker compose exec redis redis-cli FLUSHALL && cd apps/server && pnpm vitest run rfq`
Expected: unit + integration rfq tests pass.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/rfq
git commit -m "feat(rfq): add business header, tender ref and instructions to the quote sheet"
```

---

### Task 6: Frontend — instructions inputs + Word/PDF download buttons

**Files:**
- Modify: `apps/web/src/app/(dashboard)/rfqs/new/page.tsx`
- Modify: `apps/web/src/components/rfq/quote-sheet-actions.tsx`

**Interfaces:**
- Consumes: `CreateRfqInput.instructions?`, `CreateRfqItemInput.instructions?` (Task 1); `GET /rfqs/:id/documents/pdf`, `GET /rfqs/:id/documents/word` (Task 4).
- Produces: nothing new consumed by later tasks — this is the last task.

- [ ] **Step 1: Add RFQ-level instructions**

In `rfqs/new/page.tsx`, add state and wire it into the create call:

```ts
  const [instructions, setInstructions] = useState("");
```

In the "Details" `Card`, after the due-date field:

```tsx
          <div className="space-y-1">
            <label className="text-sm font-medium">Instructions (optional)</label>
            <Input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Delivery within 15 days, payment against invoice"
            />
          </div>
```

In `handleSubmit`, add `instructions: instructions.trim() || undefined,` to the `createRfq.mutateAsync({...})` call.

- [ ] **Step 2: Add per-item instructions to the manual-entry path**

`DraftItem` gains a field:

```ts
interface DraftItem {
  description: string;
  unit: string;
  quantity: string;
  instructions: string;
}

function emptyItem(): DraftItem {
  return { description: "", unit: "", quantity: "", instructions: "" };
}
```

In the manual-items `Table`, add a column header after Quantity:

```tsx
                    <TableHead>Description</TableHead>
                    <TableHead className="w-32">Unit</TableHead>
                    <TableHead className="w-32">Quantity</TableHead>
                    <TableHead className="w-48">Instructions</TableHead>
                    <TableHead className="w-10" />
```

and a cell in each row, after the Quantity cell:

```tsx
                      <TableCell>
                        <Input
                          value={item.instructions}
                          onChange={(e) => updateItem(index, { instructions: e.target.value })}
                          placeholder="ISI marked only"
                        />
                      </TableCell>
```

In `handleSubmit`'s manual-items branch, add `instructions: item.instructions.trim() || undefined,`
to the mapped `CreateRfqItemInput`.

- [ ] **Step 3: Add per-item instructions to the BOQ-picker path**

The BOQ picker reads `boqItems` directly (no per-row draft state exists there yet) — add a
parallel map:

```ts
  const [boqItemInstructions, setBoqItemInstructions] = useState<Record<string, string>>({});
```

In the BOQ-picker `Table`, add a column header after Quantity:

```tsx
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24">Unit</TableHead>
                    <TableHead className="w-24">Quantity</TableHead>
                    <TableHead className="w-48">Instructions</TableHead>
                    <TableHead className="w-56">Suggested vendors</TableHead>
```

and a cell in each row, after the Quantity cell:

```tsx
                        <TableCell>
                          <Input
                            value={boqItemInstructions[item.id] ?? ""}
                            onChange={(e) =>
                              setBoqItemInstructions((prev) => ({ ...prev, [item.id]: e.target.value }))
                            }
                            placeholder="ISI marked only"
                          />
                        </TableCell>
```

In `handleSubmit`'s BOQ-picker branch, add to the mapped item:

```ts
            instructions: boqItemInstructions[item.id]?.trim() || undefined,
```

- [ ] **Step 4: Add Word/PDF download buttons**

In `quote-sheet-actions.tsx`, add two more download functions and buttons following the
existing `download()` function's exact pattern:

```ts
  async function downloadPdf() {
    const response = await apiClient.get(`/rfqs/${rfqId}/documents/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `RFR-${rfqId}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadWord() {
    const response = await apiClient.get(`/rfqs/${rfqId}/documents/word`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `RFR-${rfqId}.docx`;
    link.click();
    URL.revokeObjectURL(url);
  }
```

In the returned JSX, after the existing "Download quote sheet" button:

```tsx
      <Button size="sm" variant="outline" onClick={() => void downloadWord()}>
        <Download className="mr-2 h-4 w-4" /> Download Word
      </Button>
      <Button size="sm" variant="outline" onClick={() => void downloadPdf()}>
        <Download className="mr-2 h-4 w-4" /> Download PDF
      </Button>
```

- [ ] **Step 5: Typecheck and lint**

Stop the dev server first — `typecheck` and `dev` race on `apps/web/.next`.

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/web lint`
Expected: both silent.

- [ ] **Step 6: Verify in the real app**

Start `pnpm dev`. On `/rfqs/new`, add an RFQ-level instruction and (in both the manual-entry
and BOQ-picker paths) a per-item instruction, then create the RFQ. On its detail page,
download all three formats and confirm each one shows the business name, RFQ title, tender
ref (if linked), due date (if set), the RFQ-level instructions, and every item with its own
per-item instruction. Open the `.docx` in Word or LibreOffice specifically — the automated
test only checks the underlying XML, not that Word itself renders the table without a repair
prompt.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): capture RFQ instructions and download Word/PDF request-for-rates documents"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `Rfq.instructions` / `RfqItem.instructions`, end to end | 1 |
| Shared `RfrDocumentData` shape | 2 |
| PDF renderer | 2 |
| Word renderer, bundled (not per-business) template | 3 |
| Ship template in production image | 3 |
| `GET /rfqs/:id/documents/pdf` / `/word`, no new RBAC keys | 4 |
| Excel enriched with header block + Instructions column, absorption untouched | 5 |
| Instructions inputs on `rfqs/new` (both item-entry paths) | 6 |
| Word/PDF download buttons | 6 |
| Unit tests for every new pure function; integration tests for every new/changed route | 1, 2, 3, 4, 5 |

No gaps.

**Placeholder scan:** none — every step has real code, real commands, or a concrete manual
verification script (Task 6 Step 6).

**Type consistency:** `RfrDocumentData`/`RfrDocumentItem` (Task 2) are consumed verbatim by
`buildRfrPdf` (Task 2), `buildRfrDocx` (Task 3), `buildQuoteSheet` (Task 5), and produced by
`toRfrDocumentData`/`loadRfrDocumentData` (Task 2/4). `ITEM_TABLE_HEADER_ROW` is defined once
in `quote-sheet.ts` (Task 5) and consumed by its own test — nothing else needs it.
`fillDocxTemplate`'s widened signature (Task 3) is backward-compatible: every existing caller
already passes a value assignable to `Record<string, unknown>`.

**Known risk carried forward:** Task 3's hand-authored OOXML table-row loop is the one piece
of this plan that cannot be fully reasoned about statically — Task 3 Step 5's automated test
(two items must produce two separate `OPC Cement`/`TMT Bars` occurrences, and no leftover
`{{#items}}`/`{{/items}}` tags) is the actual proof it works, and Task 6 Step 6 additionally
asks the implementer to open the result in real Word/LibreOffice before calling the feature
done — a document that passes the XML-text assertions but that Word refuses to open cleanly
would still be a failure.
