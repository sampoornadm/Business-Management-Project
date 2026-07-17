# Vendor Quote Capture (Piece 2)

**Date:** 2026-07-17
**Status:** Approved, not yet implemented

## Context

The estimator sends a tender's BOQ item list (without rates) to vendors, collects their rates,
then picks a vendor rate per item and applies a margin to produce the quoted rate. Today the
first half of that loop exists and the second half does not.

This spec covers **quote capture only**: recording what each vendor quoted, for which item, on
what date, with what make/model, and which items they declined. It is one piece of a larger
workflow — see [Scope boundaries](#scope-boundaries).

## What already exists (reuse, do not rebuild)

The RFQ module is already the vendor-quotation system. Verified in the schema and services:

| Capability | Where |
|---|---|
| Item list without rates, sent per tender | `Rfq`, `RfqItem` (already carries `boqItemId`) |
| Which vendor, which item, which tender | `RfqQuote.vendorId`, `RfqItem.boqItemId`, `Rfq.tenderId` |
| Vendor declined (whole RFQ) | `RfqVendorStatus.DECLINED` |
| Vendor suggestion per item | `rfq.service.ts#suggestVendors`, `VendorItemTag(itemType, make)` |
| Send by email | `buildRfqEmail` + BullMQ email queue |
| Vendor contacts | `VendorContact(email, phone, isPrimary)` |
| Excel read/write | `exceljs` — already a dependency, already used by `boq.parser` and `vendor-item-tags.parser` |
| "Send RFQ" entry point | `SendRfqDialog` in `boq-item-grid.tsx` |

## Gaps this piece closes

1. A quote records no **make/model**.
2. A quote records no **business date** — only `updatedAt`, a row-mutation timestamp.
3. **Regret is not expressible per item.** `RfqVendorStatus.DECLINED` sits on `(rfq, vendor)`,
   so "quoted 8 of 10 items, declined 2" cannot be recorded.
4. No **bulk entry path**. Rates arrive by email/WhatsApp as a list; typing them one by one
   into the UI does not scale.

## Design

### 1. Data model

Four fields on the existing `RfqQuote`:

```prisma
model RfqQuote {
  id        String   @id @default(uuid())
  rfqItemId String
  rfqItem   RfqItem  @relation(fields: [rfqItemId], references: [id], onDelete: Cascade)
  vendorId  String
  vendor    Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  rate      Float?                        // CHANGED: nullable — a regret has no rate
  regretted Boolean  @default(false)      // NEW
  make      String   @default("Unbranded") // NEW
  model     String   @default("Generic")   // NEW
  quotedAt  DateTime @default(now())       // NEW: the date the vendor gave this rate

  remarks   String?
  updatedAt DateTime @updatedAt

  @@unique([rfqItemId, vendorId])
  @@index([vendorId])
  @@map("rfq_quotes")
}
```

**Why `rate` becomes nullable.** A regret is the absence of a price, not a price of zero. The
alternative — a `regretted` flag alongside a non-null `rate` — forces a fake number into the
column and invites exactly the bug described below.

**Why regret lives on the quote, not on `RfqVendor`.** `RfqVendorStatus.DECLINED` is per
`(rfq, vendor)`. Regret is per `(item, vendor)`. Both stay: `DECLINED` still means "this vendor
is not bidding at all", while a regretted `RfqQuote` row means "this vendor is bidding, but not
for this line".

**Why `quotedAt` is not `updatedAt`.** `updatedAt` moves when someone fixes a typo. The date a
vendor quoted a rate is a business fact and feeds rate history later (Piece 4).

**Why `make`/`model` default to strings rather than null.** "Unbranded" and "Generic" are real
commodity categories, explicitly requested. This is not the `"Not specified"` fabrication
removed on 2026-07-17 — that invented a value the source never stated; these state a real one.

### 2. Regret must be excluded from rate comparisons

`rfq.service.ts` computes lowest-rate and per-vendor comparison over `item.quotes`:

```ts
const rates = item.quotes.map((q) => q.rate);          // ~line 199
const amount = round2(quote.rate * item.quantity);     // ~line 203
isLowest: quote.rate === lowestRate                    // ~line 218
```

All three must skip `regretted` rows. **A regret must never sort as the lowest bid** — that
would award an RFQ to the vendor who declined it. This is the highest-risk change in the piece
and gets a dedicated unit test.

### 3. Excel round-trip

**Export** — `GET /rfqs/:id/quote-sheet`, returns `.xlsx`:

| Column | Filled? | Notes |
|---|---|---|
| `rfqItemId` | pre-filled | **hidden column** — the re-import key |
| Item Code, Description, Unit, Qty | pre-filled | read-only reference |
| Rate, Make, Model, Regret (Y/N), Remarks | blank | the vendor fills these |

**Import** — `POST /rfqs/:id/quotes/import`, multipart file + `vendorId`, upserts one
`RfqQuote` per row.

**Rows match by hidden `rfqItemId`, never by description text.** Descriptions are 140–180 chars
of free text and vendors edit them; fuzzy matching would mislink rates to items. A row whose
`rfqItemId` is missing or unknown is reported as an error, not guessed at.

Import rules:
- `Regret = Y` → `rate = null, regretted = true` (any rate in the row is ignored).
- Blank Rate and no regret → row skipped, not stored as 0.
- Blank Make/Model → column defaults apply.
- Parse follows `vendor-item-tags.parser.ts` (ExcelJS, hand-written, no new dependency).

### 4. API

| Route | Permission | Notes |
|---|---|---|
| `GET /rfqs/:id/quote-sheet` | `rfq:read` | xlsx download |
| `POST /rfqs/:id/quotes/import` | `rfq:update` | multipart + `vendorId` |
| `PUT /:itemId/quotes/:vendorId` (existing) | `rfq:update` | gains `make`, `model`, `regretted`; `rate` becomes optional |

No new RBAC keys — `rfq:read`/`rfq:create`/`rfq:update` already exist in `ROLE_PERMISSION_MATRIX`. Follows the module conventions in `CLAUDE.md`: thin controller +
`asyncHandler` + `sendSuccess`, Zod validation per route, `@openapi` JSDoc.

### 5. UI

RFQ detail page: "Download quote sheet" and "Import filled sheet" (vendor picker). The quote
comparison table shows Make/Model columns and marks regretted lines distinctly — a regret must
be visually distinct from a missing quote, since they mean different things.

### 6. Testing

- **Unit** (`rfq.service.spec.ts`, fake repositories per house convention): regret excluded from
  lowest-rate; regret excluded from amount totals; regret round-trips as `rate = null`.
- **Unit** (new `quote-sheet.parser.spec.ts`): build a workbook in-memory with ExcelJS and parse
  it back, mirroring `vendor-item-tags.parser.spec.ts`. Covers Regret=Y, blank rate, unknown
  `rfqItemId`.
- **Integration**: export → import → quotes persisted, against the real test Postgres.

## Scope boundaries

**In:** the `RfqQuote` model changes, regret handling in comparisons, the Excel round-trip, the
two endpoints, the RFQ page controls.

**Out, by decision:**

| Deferred | Piece | Why |
|---|---|---|
| Rate-picker popup on the items tab | 3 | Needs cross-tender item identity |
| Canonical items; own-quoted rate history; prepopulation | 4 | Created on tender finalize |
| PDF/Word output; WhatsApp; download-to-share | 5 | Independent of the data model |
| Items page with filters | 1 | Independent |
| GST on vendor quotes | — | GST is on `BoqItem` only "for now" (2026-07-17) |

## Dependencies and risks

- **Depends on nothing outstanding.** Ships independently of the canonical-item work.
- **Risk: `rate` nullability.** Six call sites read `RfqQuote.rate`. TypeScript will surface all
  of them; the danger is a site that "handles" null by coercing to 0. Each must be checked by
  hand, not by whether it compiles.
- **Risk: existing rows.** `rate` going nullable is widening — no data migration, no backfill.
  `make`/`model`/`quotedAt` defaults apply to existing rows; `quotedAt` will read as the
  migration timestamp for historical quotes, which is wrong but harmless, and honest to leave
  rather than backdate from `updatedAt`.

## Related

- `2026-07-15-incoming-tenders-ingestion-design.md` — how BOQ items arrive
- `CLAUDE.md` — module conventions, AI enrichment thresholds (`AI_MATCH_THRESHOLD` calibration)
