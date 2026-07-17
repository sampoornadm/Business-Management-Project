# Vendor Quote Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what each vendor quoted per BOQ item — rate, date, make/model, and per-item regret — and let rates be collected in bulk via an Excel round-trip.

**Architecture:** Extend the existing `RfqQuote` model rather than build a parallel system; the RFQ module already covers sending item lists to vendors, vendor suggestion, and email. `rate` becomes nullable so a regret is the absence of a price. Export a pre-filled `.xlsx` per RFQ with a hidden `rfqItemId` column, and import the filled sheet back, matching rows by that id.

**Tech Stack:** Express + Prisma + PostgreSQL, Zod validation, Vitest with hand-written fake repositories, ExcelJS (already a dependency), Next.js 15 + TanStack Query on the web.

**Spec:** `docs/superpowers/specs/2026-07-17-vendor-quote-capture-design.md`

## Global Constraints

- Follow the backend module layout in `CLAUDE.md`: `*.repository.ts` (thin Prisma wrapper, `I<Name>Repository` interface + class), `*.service.ts` (constructor-injected repos, plain `new`), `*.controller.ts` (thin, `asyncHandler` + `sendSuccess`), `*.routes.ts` (`authenticateMiddleware` + `requirePermission` + `validate(zod)` + `@openapi` JSDoc), `*.validation.ts`, `*.mapper.ts`.
- Tests are **Vitest, not Jest**. Unit tests use hand-written fake repositories implementing the `I<Name>Repository` interface — no mocking framework.
- No new RBAC permission keys. `rfq:read` / `rfq:create` / `rfq:update` already exist in `ROLE_PERMISSION_MATRIX`.
- No new dependencies. `exceljs@^4.4.0` is already in `apps/server/package.json`.
- **A regretted quote must never be treated as a rate of 0** — it must be excluded from lowest-rate, amounts, and `itemsQuoted` counts.
- Rows in the imported sheet match on the hidden `rfqItemId` column only. Never match on description text.
- Integration tests need `docker compose up -d postgres redis minio minio-init mailhog` and migrations applied to `bmp_test`. Run `docker compose exec redis redis-cli FLUSHALL` first if logins start 429ing.
- `pnpm --filter @bmp/web dev|build|typecheck` all race on `apps/web/.next` — never run typecheck while the dev server is up.

## File Structure

| File | Responsibility |
|---|---|
| `packages/database/prisma/schema.prisma` | `RfqQuote`: `rate` → nullable, add `regretted`, `make`, `model`, `quotedAt` |
| `packages/types/src/rfq.ts` | `RfqQuoteDto` + comparison DTOs gain the new fields |
| `apps/server/src/modules/rfq/rfq.repository.ts` | `upsertQuote` signature widened to carry the new fields |
| `apps/server/src/modules/rfq/rfq.validation.ts` | `recordQuoteSchema`: optional rate, regret, make/model |
| `apps/server/src/modules/rfq/rfq.service.ts` | regret exclusion in `getComparison`; pass new fields through `recordQuote` |
| `apps/server/src/modules/rfq/rfq.mapper.ts` | expose new fields on `RfqQuoteDto` |
| `apps/server/src/modules/rfq/quote-sheet.ts` | **new** — build the xlsx and parse it back. One responsibility: the sheet format. |
| `apps/server/src/modules/rfq/rfq.controller.ts` | two handlers: download sheet, import sheet |
| `apps/server/src/modules/rfq/rfq.routes.ts` | two routes + `@openapi` |
| `apps/web/src/components/rfq/quote-sheet-actions.tsx` | **new** — download/import buttons + vendor picker |

`quote-sheet.ts` is deliberately its own file: the sheet's column layout is one concern, and both the export and the import must agree on it. Keeping them adjacent is what stops them drifting apart.

---

### Task 1: Schema — nullable rate, regret, make/model, quotedAt

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (model `RfqQuote`)
- Create: `packages/database/prisma/migrations/<generated>/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `RfqQuote.rate: Float | null`, `RfqQuote.regretted: boolean`, `RfqQuote.make: string`, `RfqQuote.model: string`, `RfqQuote.quotedAt: Date`.

- [ ] **Step 1: Edit the model**

Replace the `RfqQuote` model body with:

```prisma
model RfqQuote {
  id        String  @id @default(uuid())
  rfqItemId String
  rfqItem   RfqItem @relation(fields: [rfqItemId], references: [id], onDelete: Cascade)
  vendorId  String
  vendor    Vendor  @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  // Nullable because a regret is the ABSENCE of a price, not a price of zero. Anything
  // that averages, totals or ranks quotes must skip rows where regretted = true — a regret
  // sorting as the lowest bid would award an RFQ to the vendor who declined it.
  rate      Float?
  regretted Boolean @default(false)

  // Distinct from RfqVendorStatus.DECLINED, which is per (rfq, vendor) and means "not
  // bidding at all". This is per (item, vendor): "bidding, but not for this line".
  make      String   @default("Unbranded")
  model     String   @default("Generic")

  // The business date the vendor gave this rate. Not updatedAt, which moves when someone
  // fixes a typo.
  quotedAt  DateTime @default(now())

  remarks   String?
  updatedAt DateTime @updatedAt

  @@unique([rfqItemId, vendorId])
  @@index([vendorId])
  @@map("rfq_quotes")
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `pnpm db:migrate --name rfq_quote_make_model_regret`
Expected: `Your database is now in sync with your schema.` and a new folder under `packages/database/prisma/migrations/`.

- [ ] **Step 3: Apply to the test database**

Run:
```bash
cd packages/database && DATABASE_URL="postgresql://bmp:bmp_dev_password@localhost:5432/bmp_test?schema=public" pnpm exec prisma migrate deploy
```
Expected: `All migrations have been successfully applied.`

Skipping this makes every RFQ integration test fail with `The column rfq_quotes.regretted does not exist` — a red herring that looks like a code bug.

- [ ] **Step 4: Confirm existing rows survived**

Run:
```bash
docker compose exec -T postgres psql -U bmp -d bmp -c "SELECT count(*) total, count(rate) with_rate, count(*) FILTER (WHERE regretted) regrets FROM rfq_quotes;"
```
Expected: `regrets` is 0 and `with_rate` equals `total` — widening `rate` to nullable must not have dropped data.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma
git commit -m "feat(rfq): allow quotes to carry make/model, quote date, and per-item regret

rate becomes nullable: a regret is the absence of a price, not zero."
```

---

### Task 2: Exclude regrets from comparison maths

This is the highest-risk change in the plan. Do it before anything reads the new fields.

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts:194-222` (`getComparison`)
- Modify: `apps/server/src/modules/purchase-orders/purchase-orders.service.ts:120-135` (`createFromRfq`)
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`
- Test: `apps/server/src/modules/purchase-orders/__tests__/purchase-orders.service.spec.ts`

**Interfaces:**
- Consumes: `RfqQuote.rate: Float | null`, `RfqQuote.regretted: boolean` (Task 1).
- Produces: `getComparison` returns `RfqComparisonDto` where regretted quotes contribute nothing to `lowestRate`, vendor totals, or `itemsQuoted`; `createFromRfq` refuses to build a PO line from a regretted quote.

- [ ] **Step 1: Write the failing test**

Add to `rfq.service.spec.ts`, inside the existing `describe("RfqService")`. Follow the fake-repository setup already in that file.

```ts
it("excludes a regretted quote from the lowest rate, totals and itemsQuoted", async () => {
  // Vendor A quotes 100. Vendor B regretted this line. B must not win it at 0.
  const rfqId = await seedRfqWithQuotes([
    { vendorId: "vendor-a", vendorName: "A", rate: 100, regretted: false },
    { vendorId: "vendor-b", vendorName: "B", rate: null, regretted: true },
  ]);

  const comparison = await service.getComparison(rfqId, businessId);

  const line = comparison.items[0]!;
  const a = line.quotes.find((q) => q.vendorId === "vendor-a")!;
  const b = line.quotes.find((q) => q.vendorId === "vendor-b")!;

  expect(a.isLowest).toBe(true);
  expect(b.isLowest).toBe(false);
  expect(b.rate).toBeNull();
  expect(b.amount).toBeNull();

  const totalB = comparison.vendorTotals.find((v) => v.vendorId === "vendor-b")!;
  expect(totalB.total).toBe(0);
  expect(totalB.itemsQuoted).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run rfq.service.spec.ts -t "excludes a regretted quote"`
Expected: FAIL — currently `Math.min(...[100, null])` coerces null to 0, so vendor B is reported as lowest at 0.

- [ ] **Step 3: Fix `getComparison`**

Replace the body of the `rfq.items.map(...)` callback in `getComparison`:

```ts
const items: RfqComparisonItemDto[] = rfq.items.map((item) => {
  // Regretted rows carry no rate. They must not reach Math.min: a null coerces to 0 and
  // the vendor who declined the line would be reported as the cheapest bid on it.
  const priced = item.quotes.filter((q) => !q.regretted && q.rate !== null);
  const rates = priced.map((q) => q.rate as number);
  const lowestRate = rates.length > 0 ? Math.min(...rates) : null;

  const quotes = item.quotes.map((quote) => {
    const isPriced = !quote.regretted && quote.rate !== null;
    const amount = isPriced ? round2((quote.rate as number) * item.quantity) : null;

    if (isPriced) {
      const existing = vendorTotals.get(quote.vendor.id) ?? {
        vendorName: quote.vendor.name,
        total: 0,
        itemsQuoted: 0,
      };
      existing.total = round2(existing.total + (amount as number));
      existing.itemsQuoted += 1;
      vendorTotals.set(quote.vendor.id, existing);
    } else {
      // Still register the vendor so a wholly-regretting vendor appears with a zero total
      // rather than vanishing from the comparison.
      if (!vendorTotals.has(quote.vendor.id)) {
        vendorTotals.set(quote.vendor.id, {
          vendorName: quote.vendor.name,
          total: 0,
          itemsQuoted: 0,
        });
      }
    }

    return {
      vendorId: quote.vendor.id,
      vendorName: quote.vendor.name,
      rate: quote.rate,
      amount,
      isLowest: isPriced && quote.rate === lowestRate,
      regretted: quote.regretted,
      make: quote.make,
      model: quote.model,
    };
  });
  // ...rest of the existing return unchanged
});
```

- [ ] **Step 4: Update the comparison DTOs**

In `packages/types/src/rfq.ts`, widen `RfqComparisonQuoteDto` (the element type of
`RfqComparisonItemDto.quotes`, around lines 83-88):

```ts
export interface RfqComparisonQuoteDto {
  vendorId: string;
  vendorName: string;
  rate: number | null;
  amount: number | null;
  isLowest: boolean;
  regretted: boolean;
  make: string;
  model: string;
}
```

`RfqComparisonVendorTotalDto` (`{ vendorId, vendorName, total, itemsQuoted }`) is unchanged — a
wholly-regretting vendor still appears there with `total: 0, itemsQuoted: 0`.

- [ ] **Step 5: Run the test and the whole rfq suite**

Run: `cd apps/server && pnpm vitest run rfq`
Expected: PASS, including the 30 pre-existing `rfq.service.spec.ts` tests.

- [ ] **Step 6: Close the RFQ → purchase order hole**

`createFromRfq` in `purchase-orders.service.ts` currently reads:

```ts
const quote = item.quotes.find((q) => q.vendorId === awardedVendorId);
if (!quote) {
  throw new BadRequestError(
    `The awarded vendor has not quoted a rate for item: ${item.description}`,
  );
}
return {
  description: item.description,
  unit: item.unit,
  quantity: item.quantity,
  rate: quote.rate,
  amount: round2(item.quantity * quote.rate),
  sortOrder: index,
};
```

Before Task 1, "no quote row" and "no rate" were the same thing, so `!quote` was a sufficient
guard. Now a regret **is** a row — with `rate: null` — so the guard passes and
`round2(quantity * null)` yields **0**: a vendor who declined the line and then won the RFQ
produces a zero-rupee PO line. Replace the guard and the return:

```ts
const quote = item.quotes.find((q) => q.vendorId === awardedVendorId);
// A regretted quote is a row that exists with rate = null. `!quote` alone no longer means
// "no price": without the regretted/null check this builds a PO line at amount 0.
if (!quote || quote.regretted || quote.rate === null) {
  throw new BadRequestError(
    `The awarded vendor has not quoted a rate for item: ${item.description}`,
  );
}
const rate = quote.rate;
return {
  description: item.description,
  unit: item.unit,
  quantity: item.quantity,
  rate,
  amount: round2(item.quantity * rate),
  sortOrder: index,
};
```

Write the test first, in `purchase-orders.service.spec.ts`, following the fake-repository setup
already in that file:

```ts
it("refuses to build a purchase order line from a regretted quote", async () => {
  // The awarded vendor regretted this line. Before the regret column existed this could not
  // happen; now the quote row exists with rate null and must not become an amount of 0.
  seedAwardedRfqWithQuote({ vendorId: awardedVendorId, rate: null, regretted: true });

  await expect(service.createFromRfq(rfqId, input, actorId, context)).rejects.toThrow(
    BadRequestError,
  );
});
```

Run: `cd apps/server && pnpm vitest run purchase-orders.service.spec.ts -t "regretted quote"`
Expected: FAIL first (a PO is created with amount 0), then PASS after the guard change.

- [ ] **Step 7: Typecheck the whole server**

Run: `pnpm --filter @bmp/server typecheck`
Expected: no output.

Task 1 deliberately left the server not typechecking — widening `rate` to nullable breaks every
site that assumed a number. This step closes that. **Fix each site by hand; never reach for
`?? 0`**, which satisfies the compiler and silently restores the regret-as-zero bug this whole
task exists to prevent.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/rfq apps/server/src/modules/purchase-orders packages/types/src/rfq.ts
git commit -m "fix(rfq): exclude regretted quotes from lowest-rate, totals and PO conversion"
```

---

### Task 3: Record make/model/regret through the quote endpoint

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.repository.ts:75` (interface) and `:191` (implementation)
- Modify: `apps/server/src/modules/rfq/rfq.validation.ts:41`
- Modify: `apps/server/src/modules/rfq/rfq.service.ts:179` (`recordQuote`)
- Modify: `apps/server/src/modules/rfq/rfq.mapper.ts:11-18` (`toQuoteDto`)
- Modify: `packages/types/src/rfq.ts:7-12` (`RfqQuoteDto`)
- Test: `apps/server/src/modules/rfq/__tests__/rfq.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's columns.
- Produces: `upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData): Promise<void>` where

```ts
export interface UpsertQuoteData {
  rate: number | null;
  regretted: boolean;
  make?: string;
  model?: string;
  quotedAt?: Date;
  remarks?: string | null;
}
```

- [ ] **Step 1: Write the failing test**

```ts
it("records a regret with no rate, and defaults make/model when the vendor gave none", async () => {
  await service.recordQuote(rfqItemId, vendorId, { regretted: true }, actorId, businessId);

  const saved = rfqRepository.quotes.get(`${rfqItemId}:${vendorId}`)!;
  expect(saved.rate).toBeNull();
  expect(saved.regretted).toBe(true);
});

it("rejects a quote that is neither priced nor a regret", async () => {
  await expect(
    service.recordQuote(rfqItemId, vendorId, {}, actorId, businessId),
  ).rejects.toThrow(BadRequestError);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run rfq.service.spec.ts -t "records a regret"`
Expected: FAIL — `recordQuote` currently requires `rate`.

- [ ] **Step 3: Widen the validation schema**

In `rfq.validation.ts`, replace `rate: z.number().nonnegative(),` in the record-quote schema with:

```ts
    // Either a rate or a regret. Enforced by the refine below rather than by making rate
    // required, because a regret legitimately has no rate.
    rate: z.number().nonnegative().optional(),
    regretted: z.boolean().optional(),
    make: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    quotedAt: z.coerce.date().optional(),
```

and add to that schema object, after the closing `}`:

```ts
  .refine((d) => d.regretted === true || d.rate !== undefined, {
    message: "Provide a rate, or mark the item as regretted",
  })
```

- [ ] **Step 4: Widen the repository**

Replace the interface line and implementation:

```ts
  // interface
  upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData): Promise<void>;

  // implementation
  async upsertQuote(rfqItemId: string, vendorId: string, data: UpsertQuoteData): Promise<void> {
    const payload = {
      rate: data.rate,
      regretted: data.regretted,
      remarks: data.remarks ?? null,
      // Omit rather than pass undefined so the column defaults apply on create.
      ...(data.make !== undefined ? { make: data.make } : {}),
      ...(data.model !== undefined ? { model: data.model } : {}),
      ...(data.quotedAt !== undefined ? { quotedAt: data.quotedAt } : {}),
    };
    await this.prisma.rfqQuote.upsert({
      where: { rfqItemId_vendorId: { rfqItemId, vendorId } },
      create: { id: randomUUID(), rfqItemId, vendorId, ...payload },
      update: payload,
    });
  }
```

- [ ] **Step 5: Pass the fields through the service**

In `recordQuote`, replace the `upsertQuote` call:

```ts
    const regretted = input.regretted === true;
    await this.rfqRepository.upsertQuote(rfqItemId, vendorId, {
      rate: regretted ? null : (input.rate ?? null),
      regretted,
      make: input.make,
      model: input.model,
      quotedAt: input.quotedAt,
      remarks: input.remarks,
    });
```

and widen the audit metadata: `metadata: { rfqItemId, vendorId, rate: input.rate ?? null, regretted }`.

- [ ] **Step 6: Expose the fields on the DTO**

`packages/types/src/rfq.ts`, `RfqQuoteDto`:

```ts
export interface RfqQuoteDto {
  vendorId: string;
  rate: number | null;
  regretted: boolean;
  make: string;
  model: string;
  quotedAt: string;
  remarks: string | null;
  updatedAt: string;
}
```

`rfq.mapper.ts`, `toQuoteDto`:

```ts
function toQuoteDto(quote: RfqItemDetail["quotes"][number]): RfqQuoteDto {
  return {
    vendorId: quote.vendorId,
    rate: quote.rate,
    regretted: quote.regretted,
    make: quote.make,
    model: quote.model,
    quotedAt: quote.quotedAt.toISOString(),
    remarks: quote.remarks,
    updatedAt: quote.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `cd apps/server && pnpm vitest run rfq && cd .. && cd .. && pnpm --filter @bmp/server typecheck`
Expected: all rfq tests pass, typecheck silent.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/rfq packages/types/src/rfq.ts
git commit -m "feat(rfq): record make, model, quote date and per-item regret on quotes"
```

---

### Task 4: The quote sheet — build and parse

**Files:**
- Create: `apps/server/src/modules/rfq/quote-sheet.ts`
- Test: `apps/server/src/modules/rfq/__tests__/quote-sheet.spec.ts`

**Interfaces:**
- Consumes: `UpsertQuoteData` (Task 3).
- Produces:

```ts
export interface QuoteSheetRow {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
}
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
export function buildQuoteSheet(rfqTitle: string, rows: QuoteSheetRow[]): Promise<Buffer>;
export function parseQuoteSheet(buffer: Buffer): Promise<ParsedQuoteSheet>;
```

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/modules/rfq/__tests__/quote-sheet.spec.ts`. This mirrors `vendor-item-tags.parser.spec.ts`: build a real workbook in memory, then parse it back.

```ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildQuoteSheet, parseQuoteSheet } from "../quote-sheet.js";

const ROWS = [
  { rfqItemId: "item-1", description: "XLPE Cable 4C x16", unit: "m", quantity: 100 },
  { rfqItemId: "item-2", description: "XLPE Cable 4C x25", unit: "m", quantity: 50 },
];

// Column letters: A=rfqItemId (hidden), B=Item Code, C=Description, D=Unit, E=Qty,
// F=Rate, G=Make, H=Model, I=Regret, J=Remarks. Row 1 is the header, so data starts at row 2.
async function fill(edit: (sheet: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteSheet("RFQ-1", ROWS));
  edit(wb.worksheets[0]!);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("quote sheet", () => {
  it("round-trips a filled rate with make and model", async () => {
    const buffer = await fill((sheet) => {
      sheet.getCell("F2").value = 152.5;
      sheet.getCell("G2").value = "Polycab";
      sheet.getCell("H2").value = "FRLS-16";
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
      sheet.getCell("F2").value = 999; // must be ignored
      sheet.getCell("I2").value = "Y";
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
      sheet.getCell("A2").value = "";
      sheet.getCell("F2").value = 10;
    });

    const { rows, errors } = await parseQuoteSheet(buffer);

    expect(rows).toEqual([]);
    expect(errors[0]).toContain("row 2");
  });

  it("builds a sheet for an RFQ title containing characters Excel forbids", async () => {
    // Real titles come from tender titles, e.g. "MJ/C06/2025/2395-PU TUBE". ExcelJS throws
    // on : \ / ? * [ ] in a sheet name rather than sanitising it.
    const buffer = await buildQuoteSheet("MJ/C06/2025/2395-PU TUBE [rev2]", ROWS);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const name = wb.worksheets[0]!.name;

    expect(name).not.toMatch(/[:\\/?*[\]]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && pnpm vitest run quote-sheet.spec.ts`
Expected: FAIL — `Cannot find module '../quote-sheet.js'`.

- [ ] **Step 3: Implement `quote-sheet.ts`**

```ts
import ExcelJS from "exceljs";

/**
 * Column layout. Export and import MUST agree, which is why both live in this file.
 * Column A holds the rfqItemId and is hidden: rows are matched back by id, never by
 * description. Descriptions run 140-180 chars and vendors edit them freely, so any
 * text-based match would silently attach a rate to the wrong item.
 */
const COLUMNS = [
  { header: "rfqItemId", key: "rfqItemId", width: 38, hidden: true },
  { header: "Item Code", key: "itemCode", width: 16 },
  { header: "Description", key: "description", width: 60 },
  { header: "Unit", key: "unit", width: 10 },
  { header: "Qty", key: "quantity", width: 10 },
  { header: "Rate", key: "rate", width: 14 },
  { header: "Make", key: "make", width: 18 },
  { header: "Model", key: "model", width: 18 },
  { header: "Regret (Y/N)", key: "regret", width: 14 },
  { header: "Remarks", key: "remarks", width: 30 },
] as const;

const HEADER_ROW = 1;

export interface QuoteSheetRow {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
}

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

export async function buildQuoteSheet(rfqTitle: string, rows: QuoteSheetRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(toSheetName(rfqTitle));
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getColumn("rfqItemId").hidden = true;
  sheet.getRow(HEADER_ROW).font = { bold: true };

  for (const row of rows) {
    sheet.addRow({
      rfqItemId: row.rfqItemId,
      description: row.description,
      unit: row.unit ?? "",
      quantity: row.quantity,
    });
  }

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
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: ["The workbook has no sheets"] };

  const rows: ParsedQuoteRow[] = [];
  const errors: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === HEADER_ROW) return;

    const rfqItemId = text(row.getCell(1));
    const rateText = text(row.getCell(6));
    const regretted = text(row.getCell(9)).toUpperCase().startsWith("Y");

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

    const make = text(row.getCell(7));
    const model = text(row.getCell(8));
    const remarks = text(row.getCell(10));

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

- [ ] **Step 4: Run the tests**

Run: `cd apps/server && pnpm vitest run quote-sheet.spec.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/modules/rfq/quote-sheet.ts apps/server/src/modules/rfq/__tests__/quote-sheet.spec.ts
git commit -m "feat(rfq): add quote sheet builder and parser

Rows match on a hidden rfqItemId column, never on description text."
```

---

### Task 5: Export and import endpoints

**Files:**
- Modify: `apps/server/src/modules/rfq/rfq.service.ts` (two methods)
- Modify: `apps/server/src/modules/rfq/rfq.controller.ts`
- Modify: `apps/server/src/modules/rfq/rfq.routes.ts`
- Modify: `apps/server/src/modules/rfq/rfq.validation.ts`
- Create: `apps/server/src/modules/rfq/__tests__/rfq-quotes.integration.spec.ts` (the rfq module has **no** integration spec yet — only `rfq.service.spec.ts` and `rfq-document.spec.ts`; copy the app/login/seed bootstrap from `apps/server/src/modules/boq/__tests__/boq.integration.spec.ts`)

**Interfaces:**
- Consumes: `buildQuoteSheet`, `parseQuoteSheet`, `ParsedQuoteSheet` (Task 4); `upsertQuote` (Task 3).
- Produces: `RfqService.buildQuoteSheet(rfqId, businessId): Promise<{ filename: string; buffer: Buffer }>` and `RfqService.importQuotes(rfqId, vendorId, buffer, actorId, businessId): Promise<{ imported: number; errors: string[] }>`.

- [ ] **Step 1: Add the service methods**

```ts
  async buildQuoteSheetFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const buffer = await buildQuoteSheet(
      rfq.title,
      rfq.items.map((item) => ({
        rfqItemId: item.id,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
      })),
    );
    const safeTitle = rfq.title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60);
    return { filename: `quotes-${safeTitle || rfqId}.xlsx`, buffer };
  }

  async importQuotes(
    rfqId: string,
    vendorId: string,
    buffer: Buffer,
    actorId: string,
    businessId: string,
  ): Promise<{ imported: number; errors: string[] }> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    if (FINALIZED_STATUSES.has(rfq.status)) {
      throw new ConflictError("Cannot record quotes on a finalized RFQ");
    }
    const invite = rfq.vendorInvites.find((v) => v.vendor.id === vendorId);
    if (!invite) throw new BadRequestError("Vendor was not invited to this RFQ");

    const { rows, errors } = await parseQuoteSheet(buffer);
    // Only ids that belong to THIS rfq. A sheet from another RFQ must not write here.
    const ownItemIds = new Set(rfq.items.map((i) => i.id));

    let imported = 0;
    for (const row of rows) {
      if (!ownItemIds.has(row.rfqItemId)) {
        errors.push(`${row.rfqItemId} is not an item on this RFQ`);
        continue;
      }
      await this.rfqRepository.upsertQuote(row.rfqItemId, vendorId, {
        rate: row.rate,
        regretted: row.regretted,
        make: row.make,
        model: row.model,
        remarks: row.remarks,
      });
      imported += 1;
    }

    if (imported > 0 && invite.status === "INVITED") {
      await this.rfqRepository.updateVendorInviteStatus(rfqId, vendorId, "RESPONDED");
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTES_IMPORTED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId, imported, errorCount: errors.length },
    });

    return { imported, errors };
  }
```

Add the imports at the top of `rfq.service.ts`:

```ts
import { buildQuoteSheet, parseQuoteSheet } from "./quote-sheet.js";
```

- [ ] **Step 2: Add the validation schema**

In `rfq.validation.ts`:

```ts
export const importQuotesSchema = z.object({
  vendorId: z.string().uuid(),
});
export type ImportQuotesBody = z.infer<typeof importQuotesSchema>;
```

- [ ] **Step 3: Add the controller handlers**

```ts
  downloadQuoteSheet = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildQuoteSheetFor(
      req.params.id!,
      req.user!.businessId,
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  importQuotes = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const body = req.body as ImportQuotesBody;
    const result = await this.rfqService.importQuotes(
      req.params.id!,
      body.vendorId,
      req.file.buffer,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, result, `Imported ${result.imported} quote(s)`);
  });
```

`downloadQuoteSheet` sends a raw buffer rather than `sendSuccess` — it is a file download, not a JSON envelope.

- [ ] **Step 4: Add the routes**

In `rfq.routes.ts`, using `createUploadMiddleware` exactly as `boq.routes.ts` does:

```ts
  const uploadQuoteSheet = createUploadMiddleware("file", 5 * 1024 * 1024, [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]);

  /**
   * @openapi
   * /rfqs/{id}/quote-sheet:
   *   get:
   *     tags: [RFQ]
   *     summary: Download a pre-filled quote sheet for this RFQ's items
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: xlsx file }
   */
  router.get(
    "/:id/quote-sheet",
    authenticateMiddleware,
    requirePermission("rfq:read"),
    controller.downloadQuoteSheet,
  );

  /**
   * @openapi
   * /rfqs/{id}/quotes/import:
   *   post:
   *     tags: [RFQ]
   *     summary: Import a filled quote sheet for one vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Import summary with per-row errors }
   */
  router.post(
    "/:id/quotes/import",
    authenticateMiddleware,
    requirePermission("rfq:update"),
    uploadQuoteSheet,
    validate(importQuotesSchema),
    controller.importQuotes,
  );
```

- [ ] **Step 5: Write the integration test**

Create `rfq-quotes.integration.spec.ts`. There is no RFQ integration spec yet, so lift the
supertest app bootstrap, login helper and business seeding from
`apps/server/src/modules/boq/__tests__/boq.integration.spec.ts`, then seed an RFQ with two items
and one invited vendor. The assertions:

```ts
it("exports a quote sheet and imports it back with rates and a regret", async () => {
  const sheet = await request(app)
    .get(`/api/v1/rfqs/${rfqId}/quote-sheet`)
    .set("Authorization", `Bearer ${token}`);
  expect(sheet.status).toBe(200);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(sheet.body);
  const ws = workbook.worksheets[0]!;
  ws.getCell("F2").value = 152.5;   // Rate for the first item
  ws.getCell("I2").value = "N";
  ws.getCell("I3").value = "Y";     // Second item: regret
  const filled = Buffer.from(await workbook.xlsx.writeBuffer());

  const imported = await request(app)
    .post(`/api/v1/rfqs/${rfqId}/quotes/import`)
    .set("Authorization", `Bearer ${token}`)
    .field("vendorId", vendorId)
    .attach("file", filled, "quotes.xlsx");

  expect(imported.status).toBe(200);
  expect(imported.body.data.imported).toBe(2);
  expect(imported.body.data.errors).toEqual([]);

  const comparison = await request(app)
    .get(`/api/v1/rfqs/${rfqId}/comparison`)
    .set("Authorization", `Bearer ${token}`);
  const [first, second] = comparison.body.data.items;
  expect(first.quotes[0].rate).toBe(152.5);
  expect(second.quotes[0].regretted).toBe(true);
  expect(second.quotes[0].rate).toBeNull();
});
```

Column letters here are one past the parser's indices because ExcelJS is 1-based and column A is the hidden id: Rate is column F, Regret is column I.

- [ ] **Step 6: Run everything**

Run:
```bash
docker compose exec redis redis-cli FLUSHALL
cd apps/server && pnpm vitest run rfq
```
Expected: unit + integration rfq tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/rfq
git commit -m "feat(rfq): export and import vendor quote sheets"
```

---

### Task 6: RFQ page controls

**Files:**
- Create: `apps/web/src/components/rfq/quote-sheet-actions.tsx`
- Modify: `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`
- Modify: `apps/web/src/hooks/use-rfq.ts`

**Interfaces:**
- Consumes: `GET /rfqs/:id/quote-sheet`, `POST /rfqs/:id/quotes/import` (Task 5).
- Produces: `<QuoteSheetActions rfqId={string} vendors={{ id: string; name: string }[]} />`.

- [ ] **Step 1: Add the import hook**

In `use-rfq.ts`, following the mutation style already in that file:

```ts
export function useImportQuotes(rfqId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vendorId, file }: { vendorId: string; file: File }) => {
      const form = new FormData();
      form.append("vendorId", vendorId);
      form.append("file", file);
      const response = await apiClient.post<ApiResponse<{ imported: number; errors: string[] }>>(
        `/rfqs/${rfqId}/quotes/import`,
        form,
      );
      if (!response.data.success) throw new Error(response.data.error.message);
      return response.data.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rfq", rfqId] }),
  });
}
```

- [ ] **Step 2: Build the component**

```tsx
"use client";

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast } from "@bmp/ui";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { useImportQuotes } from "@/hooks/use-rfq";
import { apiClient } from "@/lib/axios";

export function QuoteSheetActions({
  rfqId,
  vendors,
}: {
  rfqId: string;
  vendors: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const importQuotes = useImportQuotes(rfqId);

  async function download() {
    const response = await apiClient.get(`/rfqs/${rfqId}/quote-sheet`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quotes-${rfqId}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    try {
      const result = await importQuotes.mutateAsync({ vendorId, file });
      toast({
        title: `Imported ${result.imported} quote(s)`,
        // Surface per-row problems rather than reporting a clean success over them.
        ...(result.errors.length > 0
          ? { variant: "destructive" as const, description: result.errors.slice(0, 3).join("; ") }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import quotes",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => void download()}>
        <Download className="mr-2 h-4 w-4" /> Download quote sheet
      </Button>

      <Select value={vendorId} onValueChange={setVendorId}>
        <SelectTrigger className="h-9 w-56">
          <SelectValue placeholder="Vendor to import for" />
        </SelectTrigger>
        <SelectContent>
          {vendors.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        ref={fileInput}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        disabled={!vendorId || importQuotes.isPending}
        onClick={() => fileInput.current?.click()}
      >
        <Upload className="mr-2 h-4 w-4" /> Import filled sheet
      </Button>
    </div>
  );
}
```

`Select` is bound directly to `vendorId` with an empty-string initial value — do not seed it with a `"__none__"` sentinel, which renders blank instead of the placeholder (see `CLAUDE.md`).

- [ ] **Step 3: Mount it on the RFQ detail page**

In `apps/web/src/app/(dashboard)/rfqs/[id]/page.tsx`, render it above the comparison table, passing the RFQ's invited vendors:

```tsx
<QuoteSheetActions
  rfqId={rfq.id}
  vendors={rfq.vendorInvites.map((v) => ({ id: v.vendor.id, name: v.vendor.name }))}
/>
```

`RfqVendorInviteDto` is `{ id, vendor: RfqVendorSummaryDto, status, createdAt }` — the vendor is a
nested object, so it is `v.vendor.id` / `v.vendor.name`, not `v.vendorId` / `v.vendorName`.

- [ ] **Step 4: Show make/model/regret in the comparison table**

Wherever the page renders a quote's rate, a regret must read differently from a missing quote:

```tsx
{quote.regretted ? (
  <Badge variant="outline">Regretted</Badge>
) : (
  <span className="tabular-nums">{quote.rate?.toLocaleString() ?? EMPTY_VALUE}</span>
)}
<span className="text-xs text-muted-foreground">{quote.make} / {quote.model}</span>
```

- [ ] **Step 5: Typecheck and lint**

Stop the dev server first — `typecheck` and `dev` race on `apps/web/.next`.

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/web lint`
Expected: both silent.

- [ ] **Step 6: Verify in the real app**

Start `pnpm dev`, open an RFQ with items and at least one invited vendor. Download the sheet, put a rate in one row and `Y` in another row's Regret column, import it against that vendor. Confirm: the rate appears, the regret renders as "Regretted" and not as 0, and the regretting vendor is not shown as the lowest bid.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): download and import vendor quote sheets from the RFQ page"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `rate` nullable; `regretted`, `make`, `model`, `quotedAt` | 1 |
| Regret excluded from lowest-rate/amount/itemsQuoted | 2 |
| Quote endpoint gains make/model/regretted | 3 |
| Export sheet, hidden `rfqItemId`, blank right-hand columns | 4 |
| Import: Regret=Y wins, blank rate skipped, unknown id errors | 4 |
| `GET /rfqs/:id/quote-sheet`, `POST /rfqs/:id/quotes/import`, no new RBAC keys | 5 |
| RFQ page download/import, regret visually distinct | 6 |
| Unit tests (fake repos), parser tests, integration export→import | 2, 3, 4, 5 |

No gaps.

**Type consistency:** `UpsertQuoteData` is defined in Task 3 and used verbatim in Task 5. `ParsedQuoteRow`/`QuoteSheetRow`/`buildQuoteSheet`/`parseQuoteSheet` are defined in Task 4 and consumed in Task 5 with matching names. `RfqQuoteDto` (Task 3) and the comparison quote entry (Task 2) both carry `rate: number | null`, `regretted`, `make`, `model`.

**Known risk carried forward:** Task 2 Step 6 warns against `?? 0` when fixing null-rate typecheck errors. That single shortcut would reintroduce the regret-as-lowest-bid bug while making the compiler happy — it is the one thing a reviewer should look hardest at.
