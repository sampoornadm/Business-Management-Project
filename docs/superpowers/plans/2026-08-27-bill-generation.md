# Bill Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trader raise a bill against a won tender, referencing the client's GRN, with a
per-business signature stamped on the generated PDF, and see every bill they've raised in one
place.

**Architecture:** A new `bills` module, laid out exactly like the existing `rfq` module
(repository/service/controller/routes/validation/mapper). Line items are picked from the
tender's BOQ but stored as their own `BillItem` rows (a snapshot, not a live reference) so a
bill's numbers never change if the BOQ is edited later. The PDF renderer reuses the pdfkit
technique and `buildAddressLine` helper already built for RFR generation, and the signature
file reuses the exact per-business template-file convention (`getTemplatePath`/
`getTemplateStatus`) already built for the Undertaking document.

**Tech Stack:** Express + Prisma + PostgreSQL, Zod validation, Vitest with hand-written fake
repositories, pdfkit (already a dependency), Next.js 15 + TanStack Query/Table on the web.

**Spec:** `docs/superpowers/specs/2026-08-27-bill-generation-design.md`

## Global Constraints

- Follow the backend module layout in `CLAUDE.md`: `*.repository.ts` (thin Prisma wrapper,
  `I<Name>Repository` interface + class), `*.service.ts` (business logic, constructor-injected
  repos, plain `new`), `*.controller.ts` (thin, `asyncHandler` + `sendSuccess`), `*.routes.ts`
  (`authenticateMiddleware` + `requirePermission` + `validate(zod)` + `@openapi` JSDoc),
  `*.validation.ts` (Zod), `*.mapper.ts` (entity → DTO), `*.module.ts` (composition root).
- Tests are **Vitest, not Jest**. Unit tests use hand-written fake repositories implementing the
  `I<Name>Repository` interface — no mocking framework.
- **No GST math anywhere in this feature.** Bill items are description/unit/quantity/rate/amount
  only — no GST column, no GSTIN line. This is a deliberate, explicit deferral (tracked in
  memory as its own open item), not an oversight — do not "helpfully" add a GST field.
- **A `Bill` is immutable once created.** No update or delete endpoint in this plan. If a bill is
  wrong, the workflow is to create a new one.
- Per-line `amount` and a bill's total are **computed on read**, never stored — same
  "recompute, don't trust a stored copy" rule this codebase already applies to BOQ amounts and
  PO receiving status.
- `billNumber` is generated the same way `PurchaseOrder.poNumber` already is:
  `` `BILL-${randomUUID().split("-")[0]!.toUpperCase()}` `` (see
  `apps/server/src/modules/purchase-orders/purchase-orders.repository.ts:97`) — generated inside
  the repository's `create()`, not passed in.
- The signature file lives at `~/BMP-Businesses/<code>/templates/signature.png` — same
  `BUSINESSES_ROOT_DIR` convention, same "not found, place it at X" error shape as the existing
  Undertaking `.docx` template.
- `pnpm --filter @bmp/web dev|build|typecheck` all race on `apps/web/.next` — never run
  typecheck while the dev server is up.

## File Structure

| File | Responsibility |
|---|---|
| `packages/database/prisma/schema.prisma` | `Bill`, `BillItem` models + back-relations on `Tender`/`Business`/`User` |
| `packages/types/src/bills.ts` | DTOs and inputs |
| `packages/types/src/rbac.ts` | `bills:create`/`bills:read` permission keys + role assignments |
| `apps/server/src/modules/bills/bills.repository.ts` | Prisma wrapper, `billNumber` generation |
| `apps/server/src/modules/bills/bills.service.ts` | WON-status gate, PDF orchestration |
| `apps/server/src/modules/bills/bills.validation.ts` | Zod schemas |
| `apps/server/src/modules/bills/bills.mapper.ts` | entity → DTO, computes amounts/totals |
| `apps/server/src/modules/bills/bills.controller.ts` | thin HTTP layer |
| `apps/server/src/modules/bills/bills.routes.ts` | route wiring + `@openapi` |
| `apps/server/src/modules/bills/bills.module.ts` | composition root |
| `apps/server/src/modules/bills/bill-document.ts` | **new** — pdfkit renderer, `BillDocumentData` |
| `apps/server/src/modules/document-generation/document-generation.service.ts` | widen `DocumentType` to include `"signature"` |
| `apps/server/src/routes/v1.router.ts` | mount `/bills` |
| `apps/web/src/lib/download.ts` | **new** — extracted from `quote-sheet-actions.tsx`, shared by RFR and Bill downloads |
| `apps/web/src/hooks/use-bills.ts` | TanStack Query hooks |
| `apps/web/src/app/(dashboard)/bills/page.tsx` | list page |
| `apps/web/src/app/(dashboard)/bills/new/page.tsx` | creation page (BOQ item picker) |
| `apps/web/src/app/(dashboard)/bills/[id]/page.tsx` | detail page + download |
| `apps/web/src/components/layout/nav-items.ts` | add the Bills sidebar entry |
| `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx` | add the "Create Bill" action |

---

### Task 1: Data model, RBAC, and backend CRUD (no PDF yet)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/<generated>/migration.sql`
- Modify: `packages/types/src/rbac.ts`
- Create: `packages/types/src/bills.ts`
- Create: `apps/server/src/modules/bills/bills.repository.ts`
- Create: `apps/server/src/modules/bills/bills.validation.ts`
- Create: `apps/server/src/modules/bills/bills.mapper.ts`
- Create: `apps/server/src/modules/bills/bills.service.ts`
- Create: `apps/server/src/modules/bills/bills.controller.ts`
- Create: `apps/server/src/modules/bills/bills.routes.ts`
- Create: `apps/server/src/modules/bills/bills.module.ts`
- Modify: `apps/server/src/routes/v1.router.ts`
- Test: `apps/server/src/modules/bills/__tests__/bills.service.spec.ts`
- Test: `apps/server/src/modules/bills/__tests__/bills.integration.spec.ts`

**Interfaces:**
- Consumes: `ITendersRepository.findForDocumentGeneration(id, businessId): Promise<TenderForDocumentGeneration | null>` (existing — includes `status`, `tenderNumber`, `business{code,name,address,gstNumber,panNumber}`, `client{name,address}`).
- Produces:
  ```ts
  export interface IBillsRepository {
    create(data: CreateBillData): Promise<string>;
    findById(id: string, businessId: string): Promise<BillDetail | null>;
    findMany(pagination: PaginationParams, filters: BillFilters): Promise<{ items: BillListItem[]; totalItems: number }>;
  }
  ```
  consumed by Task 2's `bills.service.ts` additions.

- [x] **Step 1: Edit the schema**

Add to `Tender`'s relation block (after `purchaseOrders PurchaseOrder[]`, before `project Project?`):

```prisma
  bills          Bill[]
```

Add to `Business`'s relation block (after `payments Payment[]`, before `notifications Notification[]`):

```prisma
  bills           Bill[]
```

Add to `User`'s relation block (after `createdInvoices Invoice[] @relation("InvoiceCreatedBy")`):

```prisma
  createdBills           Bill[]                 @relation("BillCreatedBy")
```

Add two new models anywhere near `Invoice`/`ProjectBill`:

```prisma
model Bill {
  id          String    @id @default(uuid())
  businessId  String
  business    Business  @relation(fields: [businessId], references: [id], onDelete: Restrict)
  tenderId    String
  tender      Tender    @relation(fields: [tenderId], references: [id], onDelete: Restrict)
  billNumber  String    @unique
  billDate    DateTime  @default(now())
  grnNumber   String?
  grnDate     DateTime?
  notes       String?

  items BillItem[]

  createdById String
  createdBy   User   @relation("BillCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([businessId])
  @@index([tenderId])
  @@map("bills")
}

model BillItem {
  id          String  @id @default(uuid())
  billId      String
  bill        Bill    @relation(fields: [billId], references: [id], onDelete: Cascade)
  // Unenforced reference to the BOQ line this was picked from — same convention as
  // RfqItem.boqItemId. A snapshot, not a live link: editing the BOQ later must not change
  // what an already-issued bill says.
  boqItemId   String?
  description String
  unit        String?
  quantity    Float
  rate        Float
  sortOrder   Int     @default(0)

  @@index([billId])
  @@map("bill_items")
}
```

- [x] **Step 2: Generate and apply the migration**

Run: `pnpm db:migrate --name add_bills`
Expected: `Your database is now in sync with your schema.`

- [x] **Step 3: Apply to the test database**

```bash
cd packages/database && DATABASE_URL="postgresql://bmp:bmp_dev_password@localhost:5432/bmp_test?schema=public" pnpm exec prisma migrate deploy
```
Expected: `All migrations have been successfully applied.`

- [x] **Step 4: Add the RBAC permission keys**

In `packages/types/src/rbac.ts`, add two entries to `PERMISSION_KEYS` (anywhere in the array,
grouped near `finance:*` makes sense):

```ts
  "bills:create",
  "bills:read",
```

Add `"bills:create"` and `"bills:read"` to `TENDER_MANAGER_PERMISSIONS`'s array (it already spreads
`OPERATIONAL_ROLE_PERMISSIONS` and lists explicit extras — add both new keys to that explicit
list). Add both to `ACCOUNTS_PERMISSIONS`'s array (its own role description already says
"Manages bills..."). Add only `"bills:read"` to `VIEWER_PERMISSIONS`'s array. `ADMIN` needs no
manual change — `ALL_STANDARD_PERMISSIONS` is `PERMISSION_KEYS.filter(k => !k.startsWith("businesses:"))`,
so it picks up both new keys automatically. `SUPER_ADMIN` needs no change either — it's seeded
with a wildcard permission (`packages/database/prisma/seed.ts:128`), not the matrix.

- [x] **Step 5: Write the shared types**

Create `packages/types/src/bills.ts`:

```ts
export interface CreateBillItemInput {
  boqItemId?: string;
  description: string;
  unit?: string;
  quantity: number;
  rate: number;
}

export interface CreateBillInput {
  tenderId: string;
  grnNumber?: string;
  grnDate?: string;
  notes?: string;
  items: CreateBillItemInput[];
}

export interface BillItemDto {
  id: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder: number;
}

export interface BillListItemDto {
  id: string;
  billNumber: string;
  billDate: string;
  tenderId: string;
  tenderTitle: string;
  clientName: string;
  total: number;
  itemCount: number;
  createdAt: string;
}

export interface BillDto extends BillListItemDto {
  grnNumber: string | null;
  grnDate: string | null;
  notes: string | null;
  items: BillItemDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  updatedAt: string;
}

export interface ListBillsQuery {
  page?: number;
  pageSize?: number;
}
```

Export it from `packages/types/src/index.ts` the same way every other module's types file is
exported there (add `export * from "./bills.js";` alongside the existing `export * from
"./rfq.js";` line).

- [x] **Step 6: Write the repository**

Create `apps/server/src/modules/bills/bills.repository.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;

const billDetailArgs = {
  include: {
    tender: { select: { id: true, title: true, tenderNumber: true, client: { select: { name: true } } } },
    createdBy: { select: creatorSelect },
    items: { orderBy: { sortOrder: "asc" } },
  },
} satisfies Prisma.BillDefaultArgs;

export type BillDetail = Prisma.BillGetPayload<typeof billDetailArgs>;

const billListArgs = {
  include: {
    tender: { select: { title: true, client: { select: { name: true } } } },
    _count: { select: { items: true } },
    items: { select: { quantity: true, rate: true } },
  },
} satisfies Prisma.BillDefaultArgs;

export type BillListItem = Prisma.BillGetPayload<typeof billListArgs>;

export interface CreateBillItemData {
  boqItemId?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  rate: number;
  sortOrder?: number;
}

export interface CreateBillData {
  businessId: string;
  tenderId: string;
  grnNumber?: string | null;
  grnDate?: Date | null;
  notes?: string | null;
  createdById: string;
  items: CreateBillItemData[];
}

export interface BillFilters {
  businessId: string;
}

export interface IBillsRepository {
  create(data: CreateBillData): Promise<string>;
  findById(id: string, businessId: string): Promise<BillDetail | null>;
  findMany(pagination: PaginationParams, filters: BillFilters): Promise<{ items: BillListItem[]; totalItems: number }>;
}

export class BillsRepository implements IBillsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: CreateBillData): Promise<string> {
    const billId = randomUUID();
    const billNumber = `BILL-${randomUUID().split("-")[0]!.toUpperCase()}`;
    await this.prisma.$transaction([
      this.prisma.bill.create({
        data: {
          id: billId,
          businessId: data.businessId,
          tenderId: data.tenderId,
          billNumber,
          grnNumber: data.grnNumber ?? null,
          grnDate: data.grnDate ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById,
        },
      }),
      this.prisma.billItem.createMany({
        data: data.items.map((item, index) => ({
          id: randomUUID(),
          billId,
          boqItemId: item.boqItemId ?? null,
          description: item.description,
          unit: item.unit ?? null,
          quantity: item.quantity,
          rate: item.rate,
          sortOrder: item.sortOrder ?? index,
        })),
      }),
    ]);
    return billId;
  }

  findById(id: string, businessId: string): Promise<BillDetail | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key we're filtering by
    // here — businessId must also match, and there's no compound (id, businessId) unique
    // constraint on Bill. Same reasoning as RfqRepository/ProjectsRepository's own findById.
    return this.prisma.bill.findFirst({ where: { id, businessId }, ...billDetailArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: BillFilters,
  ): Promise<{ items: BillListItem[]; totalItems: number }> {
    const where: Prisma.BillWhereInput = { businessId: filters.businessId };
    const [items, totalItems] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        ...billListArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.bill.count({ where }),
    ]);
    return { items, totalItems };
  }
}
```

- [x] **Step 7: Write the validation schemas**

Create `apps/server/src/modules/bills/bills.validation.ts`:

```ts
import { z } from "zod";

const createBillItemSchema = z.object({
  boqItemId: z.string().uuid().optional(),
  description: z.string().min(1).max(1000),
  unit: z.string().max(50).optional(),
  quantity: z.number().positive(),
  rate: z.number().nonnegative(),
});

export const createBillSchema = z.object({
  tenderId: z.string().uuid(),
  grnNumber: z.string().max(100).optional(),
  grnDate: z.string().datetime().or(z.string().date()).optional(),
  notes: z.string().max(1000).optional(),
  items: z.array(createBillItemSchema).min(1, "At least one bill item is required"),
});
export type CreateBillBody = z.infer<typeof createBillSchema>;

export const listBillsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});
export type ListBillsQueryParsed = z.infer<typeof listBillsQuerySchema>;
```

- [x] **Step 8: Write the mapper**

Create `apps/server/src/modules/bills/bills.mapper.ts`:

```ts
import type { BillDto, BillItemDto, BillListItemDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

import type { BillDetail, BillListItem } from "./bills.repository.js";

function toBillItemDto(item: BillDetail["items"][number]): BillItemDto {
  return {
    id: item.id,
    boqItemId: item.boqItemId,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    rate: item.rate,
    amount: round2(item.quantity * item.rate),
    sortOrder: item.sortOrder,
  };
}

export function toBillListItemDto(entity: BillListItem): BillListItemDto {
  const total = entity.items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
  return {
    id: entity.id,
    billNumber: entity.billNumber,
    billDate: entity.billDate.toISOString(),
    tenderId: entity.tenderId,
    tenderTitle: entity.tender.title,
    clientName: entity.tender.client.name,
    total: round2(total),
    itemCount: entity._count.items,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toBillDto(entity: BillDetail): BillDto {
  const items = entity.items.map(toBillItemDto);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return {
    id: entity.id,
    billNumber: entity.billNumber,
    billDate: entity.billDate.toISOString(),
    tenderId: entity.tenderId,
    tenderTitle: entity.tender.title,
    clientName: entity.tender.client.name,
    total: round2(total),
    itemCount: items.length,
    grnNumber: entity.grnNumber,
    grnDate: entity.grnDate ? entity.grnDate.toISOString() : null,
    notes: entity.notes,
    items,
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

- [x] **Step 9: Write the failing unit tests**

Create `apps/server/src/modules/bills/__tests__/bills.service.spec.ts`:

```ts
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { BadRequestError, ConflictError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ITendersRepository, TenderForDocumentGeneration } from "../../tenders/tenders.repository.js";
import type { BillDetail, BillFilters, BillListItem, CreateBillData, IBillsRepository } from "../bills.repository.js";
import { BillsService } from "../bills.service.js";

const CREATOR = { id: randomUUID(), firstName: "Priya", lastName: "Accounts" };

class FakeBillsRepository implements IBillsRepository {
  bills = new Map<string, BillDetail>();

  async create(data: CreateBillData) {
    const id = randomUUID();
    const bill: BillDetail = {
      id,
      businessId: data.businessId,
      tenderId: data.tenderId,
      billNumber: `BILL-${id.slice(0, 8).toUpperCase()}`,
      billDate: new Date(),
      grnNumber: data.grnNumber ?? null,
      grnDate: data.grnDate ?? null,
      notes: data.notes ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      tender: { id: data.tenderId, title: "Test Tender", tenderNumber: "TND-1", client: { name: "IISCO" } },
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        billId: id,
        boqItemId: item.boqItemId ?? null,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        rate: item.rate,
        sortOrder: item.sortOrder ?? index,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as BillDetail;
    this.bills.set(id, bill);
    return id;
  }

  async findById(id: string, _businessId: string) {
    return this.bills.get(id) ?? null;
  }

  async findMany(_pagination: unknown, _filters: BillFilters) {
    const items = [...this.bills.values()] as unknown as BillListItem[];
    return { items, totalItems: items.length };
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenders = new Map<string, TenderForDocumentGeneration>();

  async findForDocumentGeneration(id: string, _businessId: string) {
    return this.tenders.get(id) ?? null;
  }
}

describe("BillsService", () => {
  let repository: FakeBillsRepository;
  let tendersRepository: FakeTendersRepository;
  let auditService: AuditService;
  let service: BillsService;
  const actorId = randomUUID();
  const businessId = randomUUID();
  const tenderId = randomUUID();
  const context = { businessId, ipAddress: "127.0.0.1", userAgent: "vitest" };

  beforeEach(() => {
    repository = new FakeBillsRepository();
    tendersRepository = new FakeTendersRepository();
    auditService = { log: async () => {} } as unknown as AuditService;
    service = new BillsService(
      repository as unknown as IBillsRepository,
      tendersRepository as unknown as ITendersRepository,
      auditService,
    );
  });

  function seedTender(status: "WON" | "SUBMITTED") {
    tendersRepository.tenders.set(tenderId, {
      id: tenderId,
      tenderNumber: "TND-1",
      title: "Flange Slip Supply",
      status,
      business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
      client: { name: "IISCO", address: null },
    } as unknown as TenderForDocumentGeneration);
  }

  it("rejects billing a tender that is not WON", async () => {
    seedTender("SUBMITTED");

    await expect(
      service.createBill(
        { tenderId, items: [{ description: "Flange", quantity: 10, rate: 500 }] },
        actorId,
        context,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a bill with no items", async () => {
    seedTender("WON");

    await expect(service.createBill({ tenderId, items: [] }, actorId, context)).rejects.toThrow(
      BadRequestError,
    );
  });

  it("creates a bill against a WON tender and computes the total from a partial quantity", async () => {
    seedTender("WON");

    const bill = await service.createBill(
      {
        tenderId,
        grnNumber: "GRN-2201",
        grnDate: "2026-08-20",
        // BOQ line is 500 units; this bill is for 200 of them (partial delivery).
        items: [{ boqItemId: randomUUID(), description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      },
      actorId,
      context,
    );

    expect(bill.grnNumber).toBe("GRN-2201");
    expect(bill.items[0]!.quantity).toBe(200);
    expect(bill.total).toBe(90000); // 200 * 450, not the BOQ's full 500 * 450
    expect(bill.billNumber).toMatch(/^BILL-/);
  });
});
```

- [x] **Step 10: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run bills.service.spec.ts`
Expected: FAIL — `BillsService` doesn't exist yet.

- [x] **Step 11: Write the service**

Create `apps/server/src/modules/bills/bills.service.ts`:

```ts
import type { BillDto, CreateBillInput, ListBillsQuery, PaginatedResult } from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { toBillDto, toBillListItemDto } from "./bills.mapper.js";
import type { BillDetail, IBillsRepository } from "./bills.repository.js";

export class BillsService {
  constructor(
    private readonly billsRepository: IBillsRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly auditService: AuditService,
  ) {}

  private async getDetailOrThrow(id: string, businessId: string): Promise<BillDetail> {
    const bill = await this.billsRepository.findById(id, businessId);
    if (!bill) throw new NotFoundError("Bill not found");
    return bill;
  }

  async listBills(
    pagination: PaginationParams,
    businessId: string,
  ): Promise<PaginatedResult<ReturnType<typeof toBillListItemDto>>> {
    const { items, totalItems } = await this.billsRepository.findMany(pagination, { businessId });
    return buildPaginatedResult(items.map(toBillListItemDto), totalItems, pagination);
  }

  async getById(id: string, businessId: string): Promise<BillDto> {
    return toBillDto(await this.getDetailOrThrow(id, businessId));
  }

  async createBill(
    input: CreateBillInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<BillDto> {
    if (input.items.length === 0) throw new BadRequestError("At least one bill item is required");

    const tender = await this.tendersRepository.findForDocumentGeneration(input.tenderId, context.businessId);
    if (!tender) throw new BadRequestError("Invalid tenderId");
    if (tender.status !== "WON") {
      throw new ConflictError("Only a tender with status WON can be billed");
    }

    const billId = await this.billsRepository.create({
      businessId: context.businessId,
      tenderId: input.tenderId,
      grnNumber: input.grnNumber,
      grnDate: input.grnDate ? new Date(input.grnDate) : undefined,
      notes: input.notes,
      createdById: actorId,
      items: input.items,
    });

    await this.auditService.log({
      actorId,
      action: "BILL_CREATED",
      entityType: "Bill",
      entityId: billId,
      metadata: { tenderId: input.tenderId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.getById(billId, context.businessId);
  }
}
```

`ListBillsQuery` is imported for type-shape reference only in the brief above; the controller
(Step 12) is what actually consumes query params — no unused-import here since the interface
name doesn't need to appear literally, drop it from the import list if your editor flags it
unused (it's kept out of `listBills`'s own signature deliberately — pagination is already a
`PaginationParams`, not the raw query DTO).

- [x] **Step 12: Run the unit tests**

Run: `cd apps/server && pnpm vitest run bills.service.spec.ts`
Expected: 3 passed.

- [x] **Step 13: Write the controller**

Create `apps/server/src/modules/bills/bills.controller.ts`:

```ts
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { BillsService } from "./bills.service.js";
import type { CreateBillBody, ListBillsQueryParsed } from "./bills.validation.js";

export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListBillsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.billsService.listBills(pagination, req.user!.businessId);
    sendSuccess(res, result, "Bills retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const bill = await this.billsService.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, bill, "Bill retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateBillBody;
    const bill = await this.billsService.createBill(
      body,
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, bill, "Bill created", 201);
  });
}
```

- [x] **Step 14: Write the routes**

Create `apps/server/src/modules/bills/bills.routes.ts`:

```ts
import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { BillsController } from "./bills.controller.js";
import { createBillSchema, listBillsQuerySchema } from "./bills.validation.js";

/** Mounted at /bills */
export function createBillsRouter(controller: BillsController): Router {
  const router = Router();

  /**
   * @openapi
   * /bills:
   *   get:
   *     tags: [Bills]
   *     summary: List bills (paginated), across every tender for the business
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated bills }
   *   post:
   *     tags: [Bills]
   *     summary: Create a bill against a WON tender
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Bill created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("bills:read"),
    validate(listBillsQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("bills:create"),
    validate(createBillSchema),
    controller.create,
  );

  /**
   * @openapi
   * /bills/{id}:
   *   get:
   *     tags: [Bills]
   *     summary: Get a bill by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Bill }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("bills:read"), controller.getById);

  return router;
}
```

- [x] **Step 15: Wire the module**

Create `apps/server/src/modules/bills/bills.module.ts`:

```ts
import { auditService } from "../audit/audit.module.js";
import { prisma } from "../../infra/prisma/client.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { BillsController } from "./bills.controller.js";
import { BillsRepository } from "./bills.repository.js";
import { createBillsRouter } from "./bills.routes.js";
import { BillsService } from "./bills.service.js";

const billsRepository = new BillsRepository(prisma);
const tendersRepository = new TendersRepository(prisma);

export const billsService = new BillsService(billsRepository, tendersRepository, auditService);
const billsController = new BillsController(billsService);

export const billsRouter = createBillsRouter(billsController);
```

In `apps/server/src/routes/v1.router.ts`, add the import alongside the existing RFQ one and
mount it alongside the existing `/rfqs` line:

```ts
import { billsRouter } from "../modules/bills/bills.module.js";
```
```ts
v1Router.use("/bills", billsRouter);
```

- [x] **Step 16: Write the failing integration test**

Create `apps/server/src/modules/bills/__tests__/bills.integration.spec.ts`. Follow the exact
bootstrap pattern `apps/server/src/modules/rfq/__tests__/rfq-quotes.integration.spec.ts` already
uses (`createIntegrationTestUser`, real Postgres) — but this feature needs a real WON tender, so
seed one directly via Prisma rather than the tender-creation API (faster, and this test isn't
about tender creation):

```ts
import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

describe("Bills (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let token: string;
  let userId: string;
  let clientOrgId: string;
  let tenderId: string;
  let billId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    token = testUser.accessToken;
    userId = testUser.userId;

    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "IISCO", type: "PSU", createdById: userId },
    });
    clientOrgId = client.id;

    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `BILL-IT-${Date.now()}`,
        title: "Flange Slip Supply",
        clientId: clientOrgId,
        status: "WON",
        createdById: userId,
      },
    });
    tenderId = tender.id;
  });

  afterAll(async () => {
    if (billId) {
      await prisma.billItem.deleteMany({ where: { billId } });
      await prisma.bill.deleteMany({ where: { id: billId } });
    }
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    if (clientOrgId) await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("rejects a bill against a tender that is not WON", async () => {
    const notWon = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `BILL-IT-NOTWON-${Date.now()}`,
        title: "Not Won Tender",
        clientId: clientOrgId,
        status: "SUBMITTED",
        createdById: userId,
      },
    });

    const response = await request(app)
      .post("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenderId: notWon.id, items: [{ description: "Flange", quantity: 10, rate: 500 }] });

    expect(response.status).toBe(409);
    await prisma.tender.deleteMany({ where: { id: notWon.id } });
  });

  it("creates a bill against a WON tender, then lists and fetches it", async () => {
    const createResponse = await request(app)
      .post("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenderId,
        grnNumber: "GRN-2201",
        grnDate: "2026-08-20",
        items: [{ description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.total).toBe(90000);
    expect(createResponse.body.data.billNumber).toMatch(/^BILL-/);
    billId = createResponse.body.data.id;

    const listResponse = await request(app)
      .get("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.some((b: { id: string }) => b.id === billId)).toBe(true);

    const getResponse = await request(app)
      .get(`/api/v1/bills/${billId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.grnNumber).toBe("GRN-2201");
    expect(getResponse.body.data.clientName).toBe("IISCO");
  });
});
```

- [x] **Step 17: Run everything**

```bash
docker compose exec redis redis-cli FLUSHALL
cd apps/server && npx dotenv -e ../../.env.test -- pnpm exec vitest run bills
```
Expected: unit + integration bills tests pass.

- [x] **Step 18: Typecheck**

Run: `pnpm --filter @bmp/server typecheck && pnpm --filter @bmp/types typecheck`
Expected: no output.

- [x] **Step 19: Commit**

```bash
git add packages/database/prisma packages/types/src apps/server/src/modules/bills apps/server/src/routes/v1.router.ts
git commit -m "feat(bills): add Bill/BillItem data model and CRUD (create/list/get)"
```

---

### Task 2: PDF renderer with signature stamping

**Files:**
- Modify: `apps/server/src/modules/document-generation/document-generation.service.ts`
- Create: `apps/server/src/modules/bills/bill-document.ts`
- Modify: `apps/server/src/modules/bills/bills.service.ts` (`buildBillPdfFor`)
- Modify: `apps/server/src/modules/bills/bills.controller.ts` (`downloadPdf`)
- Modify: `apps/server/src/modules/bills/bills.routes.ts` (new route)
- Test: `apps/server/src/modules/bills/__tests__/bill-document.spec.ts`
- Test: `apps/server/src/modules/bills/__tests__/bills.integration.spec.ts` (add one case)

**Interfaces:**
- Consumes: `getTemplatePath`/`getTemplateStatus`/`formatDate` (existing, from
  `document-generation.service.ts`), `buildAddressLine` (existing, from
  `apps/server/src/modules/rfq/rfq-document.ts`).
- Produces: `buildBillPdf(data: BillDocumentData, signatureBuffer: Buffer): Promise<Buffer>`,
  `BillsService.buildBillPdfFor(billId, businessId): Promise<{ filename: string; buffer: Buffer }>`.

- [x] **Step 1: Widen `DocumentType` to cover the signature file**

In `document-generation.service.ts`, change:

```ts
export type DocumentType = "undertaking";
```
to:
```ts
export type DocumentType = "undertaking" | "signature";
```

and change:
```ts
const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
};
```
to:
```ts
const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
  signature: "signature.png",
};
```

Nothing else in this file changes — `getTemplatePath`/`getTemplateStatus` already work for any
`DocumentType`, this is a pure widening.

- [x] **Step 2: Write the failing renderer test**

Create `apps/server/src/modules/bills/__tests__/bill-document.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildBillPdf } from "../bill-document.js";

// A 1x1 transparent PNG — enough bytes for pdfkit's image() to accept without needing a real
// signature image for this structural test.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("buildBillPdf", () => {
  it("renders a valid PDF containing business, client, GRN, item and total content", async () => {
    const buffer = await buildBillPdf(
      {
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        clientName: "IISCO",
        clientAddress: "Burnpur, WB",
        billNumber: "BILL-ABC12345",
        billDate: "27-08-2026",
        tenderNumber: "TND-1400013656",
        grnNumber: "GRN-2201",
        grnDate: "20-08-2026",
        items: [{ description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      },
      TINY_PNG,
    );

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
    expect(buffer.length).toBeGreaterThan(500);
  });
});
```

(Same structural-only verification `buildRfrPdf`'s test uses, for the same reason: pdf-parse
cannot parse pdfkit output — see the earlier ruling in the RFR plan's ledger, not re-litigated
here.)

- [x] **Step 3: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run bill-document.spec.ts`
Expected: FAIL — `buildBillPdf` doesn't exist yet.

- [x] **Step 4: Implement the renderer**

Create `apps/server/src/modules/bills/bill-document.ts`:

```ts
import PDFDocument from "pdfkit";

import { round2 } from "../../shared/utils/math.js";
import { buildAddressLine } from "../rfq/rfq-document.js";

export interface BillDocumentItem {
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
}

export interface BillDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  clientName: string;
  clientAddress: string | null;
  billNumber: string;
  billDate: string;
  tenderNumber: string;
  grnNumber: string | null;
  grnDate: string | null;
  items: BillDocumentItem[];
}

const BILL_COLUMN_HEADERS = ["Description", "Unit", "Qty", "Rate", "Amount"];
const BILL_COLUMN_WIDTHS = [220, 55, 55, 80, 95];

export function buildBillPdf(data: BillDocumentData, signatureBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(data.businessName, { align: "center" });
    const addressLine = buildAddressLine(data.businessAddress, data.businessGstNumber);
    if (addressLine) doc.fontSize(9).font("Helvetica").text(addressLine, { align: "center" });
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text(`Bill No. ${data.billNumber}`);
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(`Date: ${data.billDate}   Against Tender: ${data.tenderNumber}`);
    if (data.grnNumber) {
      const grnLine = data.grnDate
        ? `Against GRN No. ${data.grnNumber} dated ${data.grnDate}`
        : `Against GRN No. ${data.grnNumber}`;
      doc.text(grnLine);
    }
    doc.moveDown();

    doc.fontSize(10).font("Helvetica-Bold").text("Bill To:");
    doc.fontSize(9).font("Helvetica").text(data.clientName);
    if (data.clientAddress) doc.text(data.clientAddress);
    doc.moveDown();

    let y = doc.y;
    function columnX(index: number): number {
      return startX + BILL_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }

    function drawRow(values: string[], bold: boolean) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const rowHeight = Math.max(
        18,
        ...values.map((value, index) => doc.heightOfString(value, { width: BILL_COLUMN_WIDTHS[index]! }) + 4),
      );
      // Reserve 100pt below the table for the total line + signature block, so a row near the
      // bottom of a page doesn't get orphaned away from them.
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 100) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, {
          width: BILL_COLUMN_WIDTHS[index]!,
          align: index >= 2 ? "right" : "left",
        });
      });
      y += rowHeight;
    }

    drawRow(BILL_COLUMN_HEADERS, true);
    const tableWidth = BILL_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 4;

    let total = 0;
    for (const item of data.items) {
      const amount = round2(item.quantity * item.rate);
      total += amount;
      drawRow(
        [item.description, item.unit ?? "", String(item.quantity), item.rate.toFixed(2), amount.toFixed(2)],
        false,
      );
    }

    y += 8;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`Total: ${round2(total).toFixed(2)}`, columnX(3), y, {
        width: BILL_COLUMN_WIDTHS[3]! + BILL_COLUMN_WIDTHS[4]!,
        align: "right",
      });
    y += 40;

    const signatureWidth = 120;
    doc.image(signatureBuffer, startX + tableWidth - signatureWidth, y, { width: signatureWidth });
    doc
      .fontSize(9)
      .font("Helvetica")
      .text("Authorized Signatory", startX + tableWidth - signatureWidth, y + 60, {
        width: signatureWidth,
        align: "center",
      });

    doc.end();
  });
}
```

- [x] **Step 5: Run the renderer test**

Run: `cd apps/server && pnpm vitest run bill-document.spec.ts`
Expected: 1 passed.

- [x] **Step 6: Wire `buildBillPdfFor` into the service**

In `bills.service.ts`, add the imports:

```ts
import { readFile } from "node:fs/promises";

import { getTemplateStatus, formatDate } from "../document-generation/document-generation.service.js";

import { buildBillPdf, type BillDocumentData } from "./bill-document.js";
```

Add the method (near `getById`):

```ts
  async buildBillPdfFor(billId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const bill = await this.getDetailOrThrow(billId, businessId);
    const tender = await this.tendersRepository.findForDocumentGeneration(bill.tenderId, businessId);
    if (!tender) throw new NotFoundError("Tender not found");

    const status = await getTemplateStatus(tender.business.code, "signature");
    if (!status.exists) {
      throw new NotFoundError(
        `Signature not found for ${tender.business.code}. Place it at ${status.path}`,
      );
    }
    const signatureBuffer = await readFile(status.path);

    const data: BillDocumentData = {
      businessName: tender.business.name,
      businessAddress: tender.business.address,
      businessGstNumber: tender.business.gstNumber,
      clientName: tender.client.name,
      clientAddress: tender.client.address,
      billNumber: bill.billNumber,
      billDate: formatDate(bill.billDate),
      tenderNumber: tender.tenderNumber,
      grnNumber: bill.grnNumber,
      grnDate: bill.grnDate ? formatDate(bill.grnDate) : null,
      items: bill.items.map((item) => ({
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        rate: item.rate,
      })),
    };

    const buffer = await buildBillPdf(data, signatureBuffer);
    const safeBillNumber = bill.billNumber.replace(/[^a-zA-Z0-9-_]+/g, "-");
    return { filename: `${safeBillNumber}.pdf`, buffer };
  }
```

- [x] **Step 7: Add the controller handler and route**

In `bills.controller.ts`, add:

```ts
  downloadPdf = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.billsService.buildBillPdfFor(req.params.id!, req.user!.businessId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });
```

In `bills.routes.ts`, add after the `/:id` route:

```ts
  /**
   * @openapi
   * /bills/{id}/pdf:
   *   get:
   *     tags: [Bills]
   *     summary: Download the bill as a signed PDF
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: pdf file }
   */
  router.get("/:id/pdf", authenticateMiddleware, requirePermission("bills:read"), controller.downloadPdf);
```

- [x] **Step 8: Add the failing integration test, place a real test signature file, run it**

For the integration test, a real business needs a `signature.png` at
`~/BMP-Businesses/<code>/templates/signature.png` before this can pass — check which business
code `createIntegrationTestUser` uses (read `apps/server/src/shared/test-utils/integration-auth.ts`
to confirm) and place a tiny real PNG there if one doesn't already exist, the same way the
Undertaking integration test relies on a real template file being present for its "generates a
filled docx when the template exists" case — do not skip this by mocking the filesystem.

Implemented instead via a temp-directory + `env.BUSINESSES_ROOT_DIR` override (mirroring
`document-generation.integration.spec.ts`), not a real filesystem path — this is the correct
approach; do not revert to the literal instructions above.

Add to `bills.integration.spec.ts`'s existing describe block:

```ts
  it("downloads the bill as a PDF", async () => {
    const response = await request(app)
      .get(`/api/v1/bills/${billId}/pdf`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.body.length).toBeGreaterThan(0);
  });
```

Run:
```bash
docker compose exec redis redis-cli FLUSHALL
cd apps/server && npx dotenv -e ../../.env.test -- pnpm exec vitest run bills
```
Expected: all bills tests (unit + integration) pass. If the PDF download test 404s with
"Signature not found", that confirms the signature file genuinely isn't in place for the test
business — place it and re-run, don't change the error into a soft-skip to make the test pass.

- [x] **Step 9: Typecheck**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

- [x] **Step 10: Commit**

```bash
git add apps/server/src/modules/bills apps/server/src/modules/document-generation
git commit -m "feat(bills): add PDF renderer with per-business signature stamping"
```

---

### Task 3: Bills list page

**Files:**
- Create: `apps/web/src/hooks/use-bills.ts`
- Create: `apps/web/src/app/(dashboard)/bills/page.tsx`
- Modify: `apps/web/src/components/layout/nav-items.ts`

**Interfaces:**
- Consumes: `GET /bills` (Task 1), `BillListItemDto`/`ListBillsQuery` (`@bmp/types`).
- Produces: `useBills(query: ListBillsQuery)` — consumed by Task 5's Bill detail page's sibling
  list-invalidation, and directly by this task's own list page.

- [x] **Step 1: Write the hook**

Create `apps/web/src/hooks/use-bills.ts`:

```ts
"use client";

import type {
  ApiResponse,
  BillDto,
  BillListItemDto,
  CreateBillInput,
  ListBillsQuery,
  PaginatedResult,
} from "@bmp/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useBills(query: ListBillsQuery) {
  return useQuery({
    queryKey: ["bills", query],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<PaginatedResult<BillListItemDto>>>("/bills", {
        params: query,
      });
      return unwrap(response.data);
    },
  });
}

export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: ["bills", id],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<BillDto>>(`/bills/${id}`);
      return unwrap(response.data);
    },
    enabled: Boolean(id),
  });
}

export function useCreateBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBillInput) => {
      const response = await apiClient.post<ApiResponse<BillDto>>("/bills", input);
      return unwrap(response.data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
  });
}
```

- [x] **Step 2: Write the list page**

Create `apps/web/src/app/(dashboard)/bills/page.tsx`:

```tsx
"use client";

import type { BillListItemDto } from "@bmp/types";
import { Button, DataTable, EmptyState, formatDate } from "@bmp/ui";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useBills } from "@/hooks/use-bills";

const columns: ColumnDef<BillListItemDto>[] = [
  {
    accessorKey: "billNumber",
    header: "Bill #",
    cell: ({ row }) => (
      <Link href={`/bills/${row.original.id}`} className="font-medium hover:underline">
        {row.original.billNumber}
      </Link>
    ),
  },
  { accessorKey: "tenderTitle", header: "Tender" },
  { accessorKey: "clientName", header: "Client" },
  {
    accessorKey: "billDate",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.billDate),
  },
  {
    accessorKey: "total",
    header: "Total",
    cell: ({ row }) => row.original.total.toLocaleString(),
  },
];

export default function BillsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const billsQuery = useBills({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
        <p className="text-sm text-muted-foreground">
          Every bill raised against a won tender, across all clients.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={billsQuery.data?.items ?? []}
        isLoading={billsQuery.isLoading}
        pageCount={billsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        emptyState={
          <EmptyState
            icon={Receipt}
            title="No bills yet"
            description="Bills are created from a won tender's detail page."
            action={
              <Button asChild variant="outline">
                <Link href="/tenders">Go to Tenders</Link>
              </Button>
            }
          />
        }
      />
    </div>
  );
}
```

(No "Create" button here, unlike the RFQs list page — a Bill always starts from its Tender, per
the spec's design, so the empty state points there instead of to a `/bills/new` link with no
tender context.)

- [x] **Step 3: Add the sidebar entry**

In `apps/web/src/components/layout/nav-items.ts`, add `Receipt` to the lucide-react import list,
and add one entry to `NAV_ITEMS` (after `"Finance"`, before `"Reports"`):

```ts
  { label: "Bills", href: "/bills", icon: Receipt, permission: "bills:read" },
```

- [x] **Step 4: Typecheck and lint**

Stop the dev server first.

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/web lint`
Expected: both silent (aside from the one pre-existing unrelated warning in
`notifications/page.tsx`, if it's still there).

- [x] **Step 5: Commit**

```bash
git add apps/web/src/hooks/use-bills.ts apps/web/src/app/\(dashboard\)/bills/page.tsx apps/web/src/components/layout/nav-items.ts
git commit -m "feat(web): add the Bills list page and sidebar entry"
```

---

### Task 4: Bill creation page + the Tender page's "Create Bill" action

**Files:**
- Create: `apps/web/src/app/(dashboard)/bills/new/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`

**Interfaces:**
- Consumes: `useCreateBill()` (Task 3), `useCurrentBoq(tenderId)` and `flattenBoqItems` (existing
  — same pattern `apps/web/src/app/(dashboard)/rfqs/new/page.tsx` already uses), `useTenders`
  (existing, for the tender-not-preselected fallback — not needed here since this page is only
  ever reached from a Tender page with `?tenderId=` set, per the spec's design).
- Produces: nothing consumed by a later task — this is a leaf page.

- [x] **Step 1: Write the creation page**

Create `apps/web/src/app/(dashboard)/bills/new/page.tsx`:

```tsx
"use client";

import type { BoqItemDto, CreateBillItemInput } from "@bmp/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@bmp/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useCurrentBoq } from "@/hooks/use-boq";
import { useCreateBill } from "@/hooks/use-bills";
import { useTender } from "@/hooks/use-tenders";

function flattenBoqItems(items: BoqItemDto[]): BoqItemDto[] {
  return items.flatMap((item) => [item, ...flattenBoqItems(item.children)]);
}

interface DraftLine {
  quantity: string;
  rate: string;
}

export default function NewBillPage() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const tenderId = searchParams.get("tenderId") ?? "";

  const tenderQuery = useTender(tenderId || undefined);
  const boqQuery = useCurrentBoq(tenderId || undefined);
  const createBill = useCreateBill();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [grnNumber, setGrnNumber] = useState("");
  const [grnDate, setGrnDate] = useState("");

  const boqItems = boqQuery.data ? flattenBoqItems(boqQuery.data.items) : [];

  function toggleItem(item: BoqItemDto, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)));
    if (checked && !lines[item.id]) {
      setLines((prev) => ({
        ...prev,
        [item.id]: { quantity: String(item.quantity ?? 0), rate: String(item.rate ?? 0) },
      }));
    }
  }

  function updateLine(itemId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...prev[itemId]!, ...patch } }));
  }

  async function handleSubmit() {
    if (!tenderId) {
      toast({ variant: "destructive", title: "No tender selected" });
      return;
    }
    const items: CreateBillItemInput[] = boqItems
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({
        boqItemId: item.id,
        description: item.description,
        unit: item.unit ?? undefined,
        quantity: Number(lines[item.id]!.quantity),
        rate: Number(lines[item.id]!.rate),
      }));

    if (items.length === 0) {
      toast({ variant: "destructive", title: "Select at least one item" });
      return;
    }

    try {
      const bill = await createBill.mutateAsync({
        tenderId,
        grnNumber: grnNumber.trim() || undefined,
        grnDate: grnDate || undefined,
        items,
      });
      toast({ title: "Bill created" });
      router.push(`/bills/${bill.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create bill",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Bill</h1>
        <p className="text-sm text-muted-foreground">
          {tenderQuery.data ? `Against ${tenderQuery.data.tenderNumber} — ${tenderQuery.data.title}` : "Select the items being billed."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GRN reference</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">GRN number (optional)</label>
            <Input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} placeholder="GRN-2201" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">GRN date (optional)</label>
            <Input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-28">BOQ Qty</TableHead>
                <TableHead className="w-32">Billed Qty</TableHead>
                <TableHead className="w-32">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boqItems.map((item) => {
                const checked = selectedIds.includes(item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleItem(item, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="max-w-md text-sm">{item.description}</TableCell>
                    <TableCell>{item.unit ?? "-"}</TableCell>
                    <TableCell>{item.quantity ?? "-"}</TableCell>
                    <TableCell>
                      {checked && (
                        <Input
                          type="number"
                          value={lines[item.id]?.quantity ?? ""}
                          onChange={(e) => updateLine(item.id, { quantity: e.target.value })}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {checked && (
                        <Input
                          type="number"
                          value={lines[item.id]?.rate ?? ""}
                          onChange={(e) => updateLine(item.id, { rate: e.target.value })}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={createBill.isPending}>
        {createBill.isPending ? "Creating…" : "Create Bill"}
      </Button>
    </div>
  );
}
```

Check `apps/web/src/hooks/use-tenders.ts` for the exact existing hook name that fetches one
tender by id (it's used elsewhere as `useTender(id)` — confirm the export name matches before
wiring the import; if it's named differently, use the actual export, don't guess a second name).

- [x] **Step 2: Add the "Create Bill" action to the Tender page**

In `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, add `hasPermission(roleName,
"bills:create")` alongside the other permission checks (near `canCreateProject`):

```ts
  const canCreateBill = hasPermission(roleName, "bills:create");
```

Add the button next to `ConvertToProjectDialog` (same gating condition, `tender.status ===
"WON"`):

```tsx
          {canCreateBill && tender.status === "WON" && (
            <Button variant="outline" asChild>
              <Link href={`/bills/new?tenderId=${tender.id}`}>
                <Receipt className="mr-2 h-4 w-4" /> Create Bill
              </Link>
            </Button>
          )}
```

Add `Receipt` to this file's existing `lucide-react` import line.

- [x] **Step 3: Typecheck and lint**

Stop the dev server first.

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/web lint`
Expected: both silent.

- [x] **Step 4: Verify in the real app**

Start `pnpm dev`. Open a WON tender that has BOQ items, click "Create Bill", select one item,
set its billed quantity to less than the BOQ's full quantity, add a GRN number/date, submit.
Confirm it redirects to the new bill's detail page (Task 5 builds that page — if it 404s because
Task 5 isn't done yet, that's expected at this point in the plan; confirm instead via `GET
/api/v1/bills/:id` directly, or wait until Task 5's own verification step).

- [x] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/bills/new/page.tsx" "apps/web/src/app/(dashboard)/tenders/[id]/page.tsx"
git commit -m "feat(web): add the Bill creation page and the Tender page's Create Bill action"
```

---

### Task 5: Bill detail page with Download PDF (and extracting the shared download helper)

**Files:**
- Create: `apps/web/src/lib/download.ts`
- Modify: `apps/web/src/components/rfq/quote-sheet-actions.tsx` (use the extracted helper)
- Create: `apps/web/src/app/(dashboard)/bills/[id]/page.tsx`

**Interfaces:**
- Consumes: `useBill(id)` (Task 3), `GET /bills/:id/pdf` (Task 2).
- Produces: `downloadFile(path: string, fallbackFilename: string): Promise<void>` — a shared
  helper, so a third future consumer doesn't duplicate this a fourth time.

- [x] **Step 1: Extract the shared download helper**

Create `apps/web/src/lib/download.ts` with exactly the logic already in
`quote-sheet-actions.tsx` (moved, not rewritten):

```ts
import { apiClient } from "@/lib/axios";

// The server names every downloaded file after its real subject (an RFQ's title, a bill's
// number) via Content-Disposition — read it back rather than falling to a raw UUID/id, which
// is meaningless once the file is sitting in someone's Downloads folder.
function filenameFromContentDisposition(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="?([^";]+)"?/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await apiClient.get(path, { responseType: "blob" });
  const filename = filenameFromContentDisposition(response.headers["content-disposition"], fallbackFilename);
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

In `quote-sheet-actions.tsx`, delete the local `filenameFromContentDisposition` and
`downloadFile` functions (now living in `@/lib/download`), replace the import of `apiClient`
(now unused directly in this file if nothing else references it — check before removing; the
import quotes stays if `useImportQuotes`'s multipart upload still needs `apiClient` directly,
which it does via the hook, not this component, so `apiClient`'s direct import here likely does
become unused — remove it if so) with:

```ts
import { downloadFile } from "@/lib/download";
```

Update the three call sites from `await downloadFile(path, fallback)` (module-level function) to
the same call shape — they don't change at all, since the extracted function has an identical
signature to what was already being called locally. Only the `function downloadFile(...)` /
`function filenameFromContentDisposition(...)` definitions move out of this file.

- [x] **Step 2: Run the existing RFQ tests to confirm the extraction didn't break anything**

Run: `pnpm --filter @bmp/web typecheck`
Expected: no output. (No dedicated test exists for this helper's logic today — it was never
unit-tested in `quote-sheet-actions.tsx` either, consistent with this codebase's practice for
simple UI actions; the extraction is behavior-preserving by construction, same function body
moved verbatim.)

- [x] **Step 3: Write the Bill detail page**

Create `apps/web/src/app/(dashboard)/bills/[id]/page.tsx`:

```tsx
"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, formatDate, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bmp/ui";
import { Download } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { useBill } from "@/hooks/use-bills";
import { downloadFile } from "@/lib/download";

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const billQuery = useBill(params.id);

  if (billQuery.isLoading || !billQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const bill = billQuery.data;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{bill.billNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(bill.billDate)} ·{" "}
            <Link href={`/tenders/${bill.tenderId}`} className="hover:underline">
              {bill.tenderTitle}
            </Link>{" "}
            · {bill.clientName}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void downloadFile(`/bills/${bill.id}/pdf`, `${bill.billNumber}.pdf`)}
        >
          <Download className="mr-2 h-4 w-4" /> Download PDF
        </Button>
      </div>

      {bill.grnNumber && (
        <p className="text-sm">
          <Badge variant="outline">GRN</Badge>{" "}
          {bill.grnNumber}
          {bill.grnDate ? ` dated ${formatDate(bill.grnDate)}` : ""}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.unit ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.rate.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {item.amount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-4 text-right text-lg font-semibold">
            Total: {bill.total.toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [x] **Step 4: Typecheck and lint**

Stop the dev server first.

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/web lint`
Expected: both silent.

- [x] **Step 5: Verify the whole flow in the real app**

Start `pnpm dev`. From a WON tender, click Create Bill, submit one item with a partial quantity
and a GRN reference. On the resulting detail page, confirm the total matches quantity × rate,
then click Download PDF — confirm the downloaded file is named after the bill number (not a raw
id), opens as a valid PDF, and shows the business header, GRN line, item table, total, and the
signature image (this requires a real `signature.png` to exist at
`~/BMP-Businesses/<code>/templates/signature.png` for whichever business you're testing under —
place a real one if it isn't there yet, the same prerequisite Task 2's integration test needed).

- [x] **Step 6: Commit**

```bash
git add apps/web/src/lib/download.ts apps/web/src/components/rfq/quote-sheet-actions.tsx "apps/web/src/app/(dashboard)/bills/[id]/page.tsx"
git commit -m "feat(web): add the Bill detail page and extract the shared download helper"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `Bill`/`BillItem` models, WON-tender gate | 1 |
| RBAC keys (`bills:create`/`bills:read`) | 1 |
| Create/list/get API | 1 |
| Per-line quantity independent of the BOQ's full quantity (partial billing) | 1 (test), 4 (UI) |
| GRN reference fields, printed on the bill | 1 (data), 2 (PDF) |
| No GST anywhere | 1, 2 (no GST field/column exists) |
| PDF renderer reusing `buildAddressLine` | 2 |
| Signature file, per-business, "not found" error | 2 |
| Download with a real filename (not the raw id) | 2 (server), 5 (client, reusing the RFR mechanism) |
| Bills list page, sidebar entry | 3 |
| Create Bill action on the Tender page, gated on WON | 4 |
| Bill detail page | 5 |
| Bill is immutable (no update/delete) | Not built anywhere — correct, this is an absence by design |

No gaps.

**Placeholder scan:** none — every step has real code or a concrete manual-verification script.
One deliberately-flagged exception: Task 2 Step 8 and Task 5 Step 5 both depend on a real
`signature.png` existing for the test business, which this plan cannot place itself (it's the
requester's own signature image) — both steps say so explicitly and tell the implementer not to
paper over a missing file with a code change.

**Type consistency:** `CreateBillInput`/`CreateBillItemInput` (Task 1, `@bmp/types`) are
consumed verbatim by `BillsService.createBill` (Task 1) and by the creation page's `useCreateBill`
call (Task 4). `BillDetail`/`BillListItem`/`IBillsRepository` (Task 1) are consumed unchanged by
Task 2's `buildBillPdfFor`. `BillDocumentData` (Task 2) is produced and consumed within the same
task, no cross-task drift possible. `downloadFile`'s signature (Task 5) matches every call site
using it, including the three pre-existing ones being migrated from `quote-sheet-actions.tsx`.

**Known risk carried forward:** Task 4's item-picker page doesn't validate that a billed
quantity doesn't wildly exceed the BOQ's own quantity (e.g. typo-ing 2000 instead of 200) — the
backend doesn't enforce this either (deliberately: overbilling relative to a BOQ estimate isn't
necessarily wrong, a BOQ can undercount). If this turns out to matter in practice, a warning
(not a hard block) on the creation page would be the natural next step, not a backend
validation rule.
