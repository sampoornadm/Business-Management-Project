# Competitor Rates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a tender is marked Won/Lost, read SAIL ISP's comparative statement from the portal window, store every bidder's per-item rate, and show likely bidders, the rate to beat and predicted rates on a Competitors page and in the BOQ grid.

**Architecture:** The portal window hands back the statement grid as a plain `string[][]` (read in-page from the grid's `lsmatrixrowindex`/`lsmatrixcolindex` cell attributes); a pure parser turns that matrix into a typed statement; a new `competitors` server module stores it in four business-scoped tables and serves derived reads (trend, prediction, lowest bidder are computed on read, never stored). The web app triggers the fetch after the status change succeeds, so the status change can never depend on the portal.

**Tech Stack:** Express + Prisma + Vitest (server), Playwright `playwright-core` (already used by `portal-bid`), Next.js + TanStack Query + `@bmp/ui` (web). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-competitor-rates-design.md` — read it first. Mockup: `.superpowers/brainstorm/90677-1794606978/content/competitor-rates.html`.

## Global Constraints

- Follow `CLAUDE.md` module conventions exactly (repository interface + class, service with constructor-injected repos, thin controller, routes with `authenticateMiddleware` + `requirePermission` + `validate`, `@openapi` JSDoc, mapper, module composition root).
- Money columns are `Float`. Displayed with `formatMoney()`; rates in tables show two decimals.
- Rates compared and predicted are **basic price per unit**. Landed cost per unit is stored alongside.
- The app never clicks Log On and never types credentials.
- Nothing is stored unless the whole statement parses: any parser error means zero rows written.
- Marking Won/Lost must succeed regardless of the portal's state.
- A predicted rate is always labelled "predicted" and is absent with fewer than 2 data points.
- The crown means "lowest overall quote", with `aria-label="Lowest overall bidder"`. It never says "winner" or "awarded".
- New migration: `pnpm db:migrate:create --name competitor_rates`, hand-check the SQL, then `pnpm db:migrate`. Never accept a "corrective" migration that drops the `*_embeddingVector_hnsw_idx` indexes. Then `pnpm db:generate`.
- New permission `competitors:read` needs `pnpm db:seed`.
- `tender.tenderNumber` is the RFx number for SAIL tenders (`fill-bid.ts` already compares them).
- Server tests: `pnpm --filter @bmp/server exec vitest run <file>` with `.env.test` loaded as described in `CLAUDE.md`. Do not run web `typecheck` while `pnpm dev` is up.
- Deviation from the spec, decided here: the raw artifact kept on the tender is the **grid matrix as JSON**, not the page HTML. The server has no HTML parser dependency, and the matrix is exactly what the parser consumes, so it is the thing worth replaying.

## Review Focus

1. **Statement with several items** (never seen live): each item must become its own rows for every bidder; a truncated grid must be rejected, not half-stored. → Task 1 tests, Task 6 scroll step.
2. **A bidder who left an item unquoted** (empty cells): no rate row for that bidder and item, and that bidder cannot be the lowest overall bidder. → Task 1, Task 5 tests.
3. **Portal logged out / statement not published**: fetch reports "log in to the portal, then fetch again" (or "not published yet") and stores nothing; tender status is already saved. → Task 6 test.
4. **Tender with no `PortalBid`** (bid filed by hand): our own firm must not turn into a competitor. → Task 5 test (`isSelf`).
5. **Two tenders opened on the same date, or identical rates**: prediction must not divide by zero or return `NaN`. → Task 2 tests.

---

### Task 1: Statement parser

**Files:**
- Create: `apps/server/src/modules/competitors/comparative-statement.parser.ts`
- Create: `apps/server/src/modules/competitors/__tests__/fixtures/comparative-1400000013.matrix.json`
- Test: `apps/server/src/modules/competitors/__tests__/comparative-statement.parser.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface ParsedBidItem { slNo: string; itemCode: string; description: string; unit: string | null;
  rfqQuantity: number | null; offerQuantity: number | null; basicRate: number; landedRate: number | null }
export interface ParsedBid { vendorCode: string; vendorName: string; submittedBy: string | null;
  quotationRef: string; total: number | null; deliveryText: string | null; mseStatus: string | null;
  answers: Record<string, string>; items: ParsedBidItem[] }
export interface ParsedStatement { rfxNumber: string; description: string | null; bidStart: Date | null;
  bidEnd: Date | null; basisOfEvaluation: string | null; bids: ParsedBid[] }
export class StatementParseError extends Error {}
export function parseComparativeMatrix(matrix: string[][]): ParsedStatement
```

`matrix[row][0]` is the field label; `matrix[row][1..]` are bidder columns (RFQ-details rows carry their value in column 1). Missing cells are `""`.

- [ ] **Step 1: Build the fixture** from the saved capture `~/.bmp-portal-capture/1400000013/frame-1.html`. Every grid cell is a `<td ... lsmatrixrowindex="R" lsmatrixcolindex="C" ...>` whose text sits in `<span class="lsField__input">`. Write a throwaway script (scratchpad, not committed) that collects `(R, C, text)` for every such `<td>`, HTML-unescapes and collapses whitespace, and writes a dense `string[][]` as the fixture JSON. Check: row with label `Supplier Name` has 5 non-empty bidder cells; row `IGST (Ded-ITC) %` has exactly one.

- [ ] **Step 2: Write the failing tests**

```ts
const matrix = JSON.parse(readFileSync(fixture("comparative-1400000013.matrix.json"), "utf8")) as string[][];

it("reads the real 1400000013 statement", () => {
  const s = parseComparativeMatrix(matrix);
  expect(s.rfxNumber).toBe("1400000013");
  expect(s.basisOfEvaluation).toBe("Overall");
  expect(s.bidEnd?.toISOString()).toBe("2026-10-23T09:30:00.000Z"); // 23.10.2026 15:00:00 IST
  expect(s.bids.map((b) => [b.vendorCode, b.vendorName, b.quotationRef, b.total])).toEqual([
    ["1000000001", "ALPHA SPRING WORKS", "8100000001", 891000],
    ["1000000002", "BETA ENGINEERING CORPORATION", "8100000002", 528000],
    ["1000000003", "GAMMA ENGINEERING WORKS", "8100000003", 610500],
    ["1000000004", "DELTA ENTERPRISES", "8100000004", 561000],
    ["1000000005", "EPSILON INDUSTRIES", "8100000005", 940500],
  ]);
  expect(s.bids.map((b) => b.items[0]!.basicRate)).toEqual([270, 160, 185, 170, 285]);
  expect(s.bids.map((b) => b.items[0]!.landedRate)).toEqual([318.6, 188.80, 218.30, 200.60, 336.3]);
  expect(s.bids[1]!.items[0]).toMatchObject({ slNo: "001", itemCode: "20110601001260",
    description: "COIL SPRING,PSL-1397,MK-20", unit: "EA", rfqQuantity: 3300, offerQuantity: 3300 });
  expect(s.bids[1]!.deliveryText).toBe("240");
  expect(s.bids[0]!.mseStatus).toBe("MSE-GENERAL");
});

it("reads every item block of a multi-item statement", () => {
  // fixture matrix with its item block (rows from "Sl No" to "Landed Cost Per Unit ( INR )")
  // appended a second time, Sl No "002", Item Code "20110601001999", basic rates 10,20,30,40,50
  const s = parseComparativeMatrix(withSecondItem(matrix));
  expect(s.bids[0]!.items.map((i) => i.itemCode)).toEqual(["20110601001260", "20110601001999"]);
  expect(s.bids[4]!.items[1]!.basicRate).toBe(50);
});

it("skips a bidder's item when its basic rate cell is empty", () => {
  const s = parseComparativeMatrix(blankCell(matrix, "Basic Price Per Unit", 3));
  expect(s.bids[2]!.items).toEqual([]);
  expect(s.bids[1]!.items).toHaveLength(1);
});

it("parses Indian-grouped numbers", () => {
  const s = parseComparativeMatrix(setCell(matrix, "Basic Price Per Unit", 1, "1,23,456.50"));
  expect(s.bids[0]!.items[0]!.basicRate).toBe(123456.5);
});

it.each([
  ["no supplier row", (m: string[][]) => m.filter((r) => r[0] !== "Supplier Name")],
  ["item block cut short", (m: string[][]) => m.filter((r) => r[0] !== "Basic Price Per Unit")],
  ["no RFQ number", (m: string[][]) => m.filter((r) => r[0] !== "R F Q No")],
  ["empty grid", () => []],
])("rejects a statement with %s", (_name, mutate) => {
  expect(() => parseComparativeMatrix(mutate(matrix))).toThrow(StatementParseError);
});
```

- [ ] **Step 3: Run** `vitest run src/modules/competitors/__tests__/comparative-statement.parser.spec.ts` — expect FAIL (module not found).

- [ ] **Step 4: Implement `parseComparativeMatrix`.** Rules the tests do not fully pin:
  - Supplier cell format is `( <code> ) <NAME>`; bidder columns are the non-empty cells of the **first** `Supplier Name` row.
  - Header-level block = rows between `QUOTATION DETAIL(S) : R F Q HEADER LEVEL` and `QUOTATION DETAIL(S) : R F Q ITEM LEVEL`. `total` = `Total LCNITC(As Quoted)`, `deliveryText` = the row starting `Delivery period from the date of order placement`, `mseStatus` = `If MSE Provide Status ?`. Every other header row goes into `answers` keyed by its label.
  - An item block starts at each `Sl No` row in the item-level section and must contain `Item Code` and `Basic Price Per Unit` before the next `Sl No` (or the end), else `StatementParseError`.
  - Dates are `DD.MM.YYYY HH : MM : SS` in IST (+05:30).
  - Numbers: strip commas and spaces, `Number()`; non-finite → `null` (and for `basicRate`, skip that bidder's item).

- [ ] **Step 5: Run the test** — expect PASS.

- [ ] **Step 6: Commit** `feat(competitors): parse SAIL comparative statement grid`.

---

### Task 2: Rate trend and prediction

**Files:**
- Create: `apps/server/src/modules/competitors/rate-trend.ts`
- Test: `apps/server/src/modules/competitors/__tests__/rate-trend.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface RatePoint { at: Date; rate: number }
export type TrendDirection = "RISING" | "FALLING" | "FLAT";
export interface RateForecast { lastRate: number; predictedRate: number | null; direction: TrendDirection | null; points: number }
export function forecastRate(points: RatePoint[], asOf: Date): RateForecast | null  // null when points is empty
```

- [ ] **Step 1: Write the failing tests**

```ts
const d = (iso: string) => new Date(iso);
it("returns null with no history", () => expect(forecastRate([], d("2026-11-14"))).toBeNull());
it("does not predict from one point", () =>
  expect(forecastRate([{ at: d("2026-10-23"), rate: 160 }], d("2026-11-14")))
    .toEqual({ lastRate: 160, predictedRate: null, direction: null, points: 1 }));
it("extends a falling line, clamped to the last observed step", () => {
  const f = forecastRate([
    { at: d("2025-08-02"), rate: 168.5 }, { at: d("2026-03-11"), rate: 163.5 }, { at: d("2026-10-23"), rate: 160 },
  ], d("2027-10-23"))!;
  expect(f.direction).toBe("FALLING");
  expect(f.predictedRate).toBeGreaterThanOrEqual(156.5);   // last step was 3.5
  expect(f.predictedRate).toBeLessThan(160);
});
it("is flat for identical rates", () => {
  const f = forecastRate([{ at: d("2026-01-01"), rate: 170 }, { at: d("2026-06-01"), rate: 170 }], d("2026-11-14"))!;
  expect(f).toMatchObject({ predictedRate: 170, direction: "FLAT" });
});
it("survives two tenders opened the same day", () => {
  const f = forecastRate([{ at: d("2026-06-01"), rate: 100 }, { at: d("2026-06-01"), rate: 110 }], d("2026-11-14"))!;
  expect(Number.isFinite(f.predictedRate)).toBe(true);
});
it("never predicts below zero", () => {
  const f = forecastRate([{ at: d("2026-01-01"), rate: 5 }, { at: d("2026-02-01"), rate: 1 }], d("2030-01-01"))!;
  expect(f.predictedRate).toBeGreaterThanOrEqual(0);
});
it("orders points by date before fitting", () => {
  const a = { at: d("2026-01-01"), rate: 10 }, b = { at: d("2026-06-01"), rate: 20 };
  expect(forecastRate([b, a], d("2026-11-14"))).toEqual(forecastRate([a, b], d("2026-11-14")));
});
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement.** Least-squares line of rate over days; evaluate at `asOf`; if all dates are equal use the mean of the rates. Clamp `predictedRate` to `lastRate ± |lastRate − previousRate|`, floor at 0, round to 2 decimals. Direction: predicted vs last differing by more than 1% → `RISING`/`FALLING`, else `FLAT`. Add `// ponytail: naive linear trend with a one-step clamp; revisit once real history exists`.

- [ ] **Step 4: Run** — expect PASS. **Step 5: Commit** `feat(competitors): rate trend forecast`.

---

### Task 3: Tables, types, permission

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (new models + back-relations on `Business`, `Tender`, `BoqItem`)
- Create: migration via `pnpm db:migrate:create --name competitor_rates`
- Modify: `apps/server/src/infra/prisma/scoped-client.ts` (add the four models to the business-scoped list) and its spec `apps/server/src/infra/prisma/__tests__/scoped-client.spec.ts`
- Create: `packages/types/src/competitor.ts`; export from `packages/types/src/index.ts`
- Modify: `packages/types/src/rbac.ts` — add `"competitors:read"` to `PERMISSION_KEYS` and to every role that has `"tenders:read"`

**Interfaces:**
- Produces (Prisma):

```prisma
model Competitor {
  id         String   @id @default(uuid())
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  vendorCode String
  name       String
  isSelf     Boolean  @default(false)   // this "competitor" is our own firm on the portal
  bids       ComparativeBid[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@unique([businessId, vendorCode])
  @@map("competitors")
}
model ComparativeStatement {
  id                String   @id @default(uuid())
  businessId        String
  business          Business @relation(fields: [businessId], references: [id], onDelete: Restrict)
  tenderId          String   @unique
  tender            Tender   @relation(fields: [tenderId], references: [id], onDelete: Cascade)
  rfxNumber         String
  description       String?
  openedAt          DateTime            // bid end date; fetchedAt when the statement has none
  basisOfEvaluation String?
  lowestBidId       String?             // ComparativeBid.id of the lowest overall bidder, no FK
  fetchedAt         DateTime @default(now())
  bids              ComparativeBid[]
  @@index([businessId])
  @@map("comparative_statements")
}
model ComparativeBid {
  id           String   @id @default(uuid())
  businessId   String
  statementId  String
  statement    ComparativeStatement @relation(fields: [statementId], references: [id], onDelete: Cascade)
  competitorId String
  competitor   Competitor @relation(fields: [competitorId], references: [id], onDelete: Restrict)
  isUs         Boolean  @default(false)
  quotationRef String
  submittedBy  String?
  total        Float?
  deliveryText String?
  mseStatus    String?
  answers      Json
  items        ComparativeBidItem[]
  @@unique([statementId, competitorId])
  @@map("comparative_bids")
}
model ComparativeBidItem {
  id            String   @id @default(uuid())
  businessId    String
  bidId         String
  bid           ComparativeBid @relation(fields: [bidId], references: [id], onDelete: Cascade)
  itemCode      String
  description   String
  unit          String?
  rfqQuantity   Float?
  offerQuantity Float?
  basicRate     Float
  landedRate    Float?
  boqItemId     String?
  boqItem       BoqItem? @relation(fields: [boqItemId], references: [id], onDelete: SetNull)
  @@index([businessId, itemCode])
  @@map("comparative_bid_items")
}
```

Our own bid is stored as a `ComparativeBid` with `isUs = true` against a `Competitor` row with `isSelf = true` (one model for "Us" and everyone else keeps the by-item table a single query).

- Produces (`@bmp/types`, `competitor.ts`):

```ts
export type TrendDirection = "RISING" | "FALLING" | "FLAT";
export interface RateForecastDto { lastRate: number; predictedRate: number | null; direction: TrendDirection | null; points: number }
export interface CompetitorListItemDto { id: string; vendorCode: string; name: string; isSelf: boolean;
  tenderCount: number; lowestCount: number; lastSeenAt: string | null }
export interface CompetitorRateRowDto { tenderId: string; tenderNumber: string; openedAt: string; quantity: number | null;
  basicRate: number; ourRate: number | null; rank: number; bidders: number; lowestOverall: boolean }
export interface CompetitorItemDto { itemCode: string; description: string; unit: string | null;
  forecast: RateForecastDto; rates: CompetitorRateRowDto[] }
export interface CompetitorDetailDto extends CompetitorListItemDto { mseStatus: string | null; items: CompetitorItemDto[] }
export interface ItemComparisonColumnDto { competitorId: string; name: string; isSelf: boolean; forecast: RateForecastDto }
export interface ItemComparisonRowDto { tenderId: string; tenderNumber: string; openedAt: string;
  lowestOverallCompetitorId: string | null; rates: Record<string, number> } // competitorId -> basic rate
export interface ItemComparisonDto { itemCode: string; description: string; unit: string | null;
  columns: ItemComparisonColumnDto[]; rows: ItemComparisonRowDto[] }   // columns: self first, then by latest rate asc
export interface CompetitorItemSummaryDto { itemCode: string; description: string; competitorCount: number; tenderCount: number }
export interface LikelyBidderDto { competitorId: string; name: string; lastRate: number; lastTenderNumber: string;
  lastOpenedAt: string; tenders: number; forecast: RateForecastDto }
export interface RateToBeatDto { itemCode: string; rateToBeat: number | null; bidders: LikelyBidderDto[]; us: LikelyBidderDto | null }
export interface TenderRatesToBeatDto { items: RateToBeatDto[];
  likelyBidders: { competitorId: string; name: string; itemsQuoted: number }[] }
export interface FetchStatementResultDto { tenderId: string; bidders: number; items: number; lowestBidder: string | null; usFound: boolean }
```

- [ ] **Step 1:** Add the models, back-relations, scoped-client entries (extend the existing scoped-client spec's model list assertion the same way commit `2aa72b9` did for `TenderSubmission`), types, and the permission.
- [ ] **Step 2:** Create the migration, read its SQL (only four `CREATE TABLE`s, their indexes and FKs — nothing touching existing tables or HNSW indexes), `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:seed`. Apply the migration to `bmp_test` too.
- [ ] **Step 3:** Run `vitest run src/infra/prisma/__tests__/scoped-client.spec.ts` and `pnpm --filter @bmp/types typecheck` — expect PASS.
- [ ] **Step 4: Commit** `feat(competitors): tables, DTOs and competitors:read permission`.

---

### Task 4: Repository

**Files:**
- Create: `apps/server/src/modules/competitors/competitors.repository.ts`

**Interfaces:**
- Consumes: Task 1 `ParsedStatement`, Task 3 models.
- Produces:

```ts
export interface StoreStatementInput { businessId: string; tenderId: string; statement: ParsedStatement;
  openedAt: Date; usQuotationRef: string | null; boqItemIdByCode: Map<string, string> }
export interface StoredStatement { statementId: string; bidders: number; items: number; lowestBidder: string | null; usFound: boolean }
export interface RateRow { competitorId: string; competitorName: string; isSelf: boolean; itemCode: string; description: string;
  unit: string | null; quantity: number | null; basicRate: number; tenderId: string; tenderNumber: string;
  openedAt: Date; statementId: string; bidId: string; lowestBidId: string | null }
export interface ICompetitorsRepository {
  storeStatement(input: StoreStatementInput): Promise<StoredStatement>;
  listCompetitors(businessId: string): Promise<CompetitorListItemDto[]>;
  findCompetitor(businessId: string, id: string): Promise<{ id: string; vendorCode: string; name: string; isSelf: boolean; mseStatus: string | null } | null>;
  setSelf(businessId: string, id: string, isSelf: boolean): Promise<void>;
  ratesByCompetitor(businessId: string, competitorId: string): Promise<RateRow[]>;
  ratesByItemCodes(businessId: string, itemCodes: string[]): Promise<RateRow[]>;   // every bidder, incl. self
  listItems(businessId: string, search?: string): Promise<CompetitorItemSummaryDto[]>;
}
export class CompetitorsRepository implements ICompetitorsRepository { constructor(prisma: PrismaClient) }
```

- [ ] **Step 1: Implement.** `storeStatement` runs in one `$transaction`: delete the tender's existing `ComparativeStatement` (cascades), upsert each `Competitor` by `(businessId, vendorCode)` updating `name`, create statement → bids → items. `isUs` = `quotationRef === usQuotationRef` **or** the competitor's `isSelf`; when matched by quotation ref, also set that competitor's `isSelf = true`. Lowest overall bidder = smallest non-null `total` among bids whose `items.length` equals the largest `items.length` in the statement; store its id in `lowestBidId`. `RateRow` reads join through bid → statement → tender; exclude nothing (callers split self from others).
- [ ] **Step 2:** `pnpm --filter @bmp/server exec tsc --noEmit -p .` — expect clean. Behaviour is covered by Task 6's integration test.
- [ ] **Step 3: Commit** `feat(competitors): repository`.

---

### Task 5: Service, reads and routes

**Files:**
- Create: `competitors.service.ts`, `competitors.mapper.ts`, `competitors.controller.ts`, `competitors.routes.ts`, `competitors.validation.ts`, `competitors.module.ts` under `apps/server/src/modules/competitors/`
- Modify: `apps/server/src/routes/v1.router.ts` — `v1Router.use("/competitors", competitorsRouter)`
- Test: `apps/server/src/modules/competitors/__tests__/competitors.service.spec.ts` (hand-written `FakeCompetitorsRepository implements ICompetitorsRepository` holding `RateRow[]`)

**Interfaces:**
- Consumes: Task 2 `forecastRate`, Task 4 repository, `tendersRepository`, `boqRepository`, `portalBidRepository` singletons from their modules.
- Produces:

```ts
export class CompetitorsService {
  constructor(deps: { competitors: ICompetitorsRepository; tenders: ITendersRepository; boqs: IBoqRepository;
    portalBids: IPortalBidRepository; now?: () => Date })
  list(businessId: string): Promise<CompetitorListItemDto[]>
  detail(businessId: string, id: string): Promise<CompetitorDetailDto>          // NotFoundError
  setSelf(businessId: string, id: string, isSelf: boolean): Promise<void>
  items(businessId: string, search?: string): Promise<CompetitorItemSummaryDto[]>
  itemComparison(businessId: string, itemCode: string): Promise<ItemComparisonDto>
  ratesToBeat(businessId: string, tenderId: string): Promise<TenderRatesToBeatDto>
  store(businessId: string, tenderId: string, statement: ParsedStatement): Promise<FetchStatementResultDto>
}
```

Routes (all `authenticateMiddleware`): `GET /competitors`, `GET /competitors/items?search=`, `GET /competitors/items/:itemCode`, `GET /competitors/:id`, `GET /competitors/tenders/:tenderId/rates-to-beat` — `competitors:read`; `PATCH /competitors/:id` body `{ isSelf: boolean }` — `tenders:fill_portal`. Register the `/items` and `/tenders` routes before `/:id`.

- [ ] **Step 1: Write the failing tests** (seed the fake with rows mirroring the mockup: item `20110601001260`, Beta 168.5 → 163.5 → 160, DELTA 170 → 170, Gamma 165 → 204 → 185, self 310 → 270 across tenders `1400000001`, `1400000002`, `1400000013`):

```ts
it("ranks a competitor's rate within each tender and flags the lowest overall bidder", async () => {
  const d = await service.detail(BIZ, BETA);
  expect(d.items[0]!.rates[0]).toMatchObject({ tenderNumber: "1400000013", basicRate: 160, ourRate: 270, rank: 1, lowestOverall: true });
  expect(d.items[0]!.forecast.direction).toBe("FALLING");
});
it("puts our own firm first in the by-item table and never lists it as a competitor to beat", async () => {
  const c = await service.itemComparison(BIZ, "20110601001260");
  expect(c.columns[0]!.isSelf).toBe(true);
  expect(c.rows[0]!.lowestOverallCompetitorId).toBe(BETA);
  const r = await service.ratesToBeat(BIZ, TENDER_WITH_THAT_ITEM);
  expect(r.items[0]!.bidders.map((b) => b.competitorId)).not.toContain(SELF);
  expect(r.items[0]!.us?.lastRate).toBe(270);
});
it("rate to beat is the lowest predicted rate, falling back to last rate with thin history", async () => {
  const r = await service.ratesToBeat(BIZ, TENDER_WITH_THAT_ITEM);
  const beta = r.items[0]!.bidders.find((b) => b.competitorId === BETA)!;
  expect(r.items[0]!.rateToBeat).toBe(beta.forecast.predictedRate);
  // single-quote competitor on another item: rateToBeat === its lastRate
});
it("returns null rate to beat for an item nobody has quoted", ...);            // rateToBeat: null, bidders: []
it("excludes the tender's own statement from its rates to beat", ...);         // a Won tender does not predict from itself
it("ranks likely bidders by how many of the tender's items they quoted", ...);
it("store() links items to the current BOQ by item code and finds us by response number", async () => {
  // fake tender with PortalBid.responseNumber "8100000002" and a BOQ line itemCode "20110601001260"
  // -> repository receives usQuotationRef "8100000002" and boqItemIdByCode.get("20110601001260") set
});
it("store() rejects a statement for a different RFx", async () => {
  await expect(service.store(BIZ, TENDER_1400000016, parsed1400000013)).rejects.toThrow(/1400000013/);
});
it("store() with no portal bid still marks us through an isSelf competitor", ...); // usQuotationRef null passed; repository rule covers it — assert null is passed, not a guess
```

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** `store`: load tender (business-scoped, `NotFoundError`), require `statement.rfxNumber === tender.tenderNumber` (`BadRequestError` naming both numbers), `openedAt = statement.bidEnd ?? now()`, current-BOQ items (`boq.isCurrent`) → `boqItemIdByCode`, `usQuotationRef` from `portalBids` for `SAIL_ISP`. `ratesToBeat`: item codes of the tender's current BOQ → `ratesByItemCodes`, drop rows from this tender's own statement, group by item then competitor, `forecastRate(points, now())`; `rateToBeat = min(predictedRate ?? lastRate)` over non-self bidders. Ranks within a tender+item are by `basicRate` ascending.
- [ ] **Step 4: Run** — expect PASS. Typecheck clean.
- [ ] **Step 5: Commit** `feat(competitors): service, reads and routes`.

---

### Task 6: Fetching from the portal window

**Files:**
- Modify: `apps/server/src/modules/portal-bid/portal/portal-browser.ts` — add `readComparativeMatrix`, **remove** the spike `captureComparative`
- Modify: `apps/server/src/modules/portal-bid/portal-bid.controller.ts`, `portal-bid.routes.ts` — remove the spike `captureComparative` handler and `/browser/capture-comparative/:rfxNumber` route
- Modify: `competitors.controller.ts`, `competitors.routes.ts`, `competitors.module.ts` — `POST /competitors/tenders/:tenderId/fetch-statement` (`tenders:fill_portal`)
- Test: `apps/server/src/modules/portal-bid/__tests__/portal-browser.spec.ts` (extend), `apps/server/src/modules/competitors/__tests__/competitors.integration.spec.ts`

**Interfaces:**
- Produces:

```ts
export class PortalLoginRequiredError extends Error {}
export class StatementNotAvailableError extends Error {}
// on PortalBrowser:
readComparativeMatrix(rfxNumber: string): Promise<string[][]>
```

- Consumes: `CompetitorsService.store`, `parseComparativeMatrix`, `attachmentsService.upload`, `auditService.log`.

- [ ] **Step 1: Implement `readComparativeMatrix`.** Launch/reuse the context exactly as `open()` does. Reuse a tab whose URL contains `P_OBJ_ID=<rfx>`, else open a new tab at `${portalUrl}/irj/servlet/prt/portal/prtroot/pcd!3aportal_content!2fIISCO!2fIISCO_Iview!2fzsrm_dashboard_0?P_OBJ_ID=<rfx>`; bring it to front. Wait up to 30 s for a frame whose URL contains `/sap/its/webgui` and which has a `td[lsmatrixrowindex]`. If instead a frame contains `form#certLogonForm` → `PortalLoginRequiredError("Log in to the portal in the browser window, then fetch again")`. If neither within the timeout → `StatementNotAvailableError("The comparative statement is not available for this RFx yet")`. Read cells in-page (`frame.evaluate`): for each `td[lsmatrixrowindex]`, `[row, col, textContent]`, whitespace collapsed. Then scroll the grid down one page and re-read, merging by `(row, col)`, and repeat until two consecutive reads leave the merged cell count unchanged (cap 200 rounds); do the same scrolling right. Return a dense `string[][]`. Leave the tab open.
- [ ] **Step 2: Extend `portal-browser.spec.ts`** using the file's existing fake-launcher style: a fake page whose only frame has the logon form → rejects with `PortalLoginRequiredError`; a fake with no grid and no form → `StatementNotAvailableError`. (Real grid reading is exercised manually in Step 6; the fakes cannot reproduce SAP scrolling.)
- [ ] **Step 3: Endpoint.** Controller: tender must be business-scoped and `WON` or `LOST` (`BadRequestError` otherwise); `matrix = await browser.readComparativeMatrix(tender.tenderNumber)`; `parseComparativeMatrix`; `service.store`; upload the matrix JSON through `AttachmentsService` (`entityType: "TENDER"`, `documentType: "COMPARATIVE_STATEMENT"`, file name `comparative-<rfx>.json`) using the same call shape the tender documents code uses; `auditService.log` action `COMPARATIVE_STATEMENT_FETCHED` with bidder/item counts. Map `PortalLoginRequiredError` and `StatementNotAvailableError` to `ConflictError` (409) and `StatementParseError` to `UnprocessableEntity`/`BadRequestError` with the message "Could not read the comparative statement: <reason>. Nothing was saved." Inject the matrix reader into the controller as a function (`readMatrix: (rfx: string) => Promise<string[][]>`) so the integration test can substitute it.
- [ ] **Step 4: Integration test** (`competitors.integration.spec.ts`, real Postgres, reader substituted with the Task 1 fixture):

```ts
it("stores the statement for a LOST tender and serves it back", async () => {
  // tender numbered 1400000013, status LOST, PortalBid responseNumber 8100000001, BOQ line itemCode 20110601001260
  const res = await post(`/competitors/tenders/${tenderId}/fetch-statement`).expect(200);
  expect(res.body.data).toMatchObject({ bidders: 5, items: 1, lowestBidder: "BETA ENGINEERING CORPORATION", usFound: true });
  const list = (await get("/competitors")).body.data;
  expect(list).toHaveLength(5);
  expect(list.find((c) => c.vendorCode === "1000000001").isSelf).toBe(true);
});
it("replaces, not duplicates, on a second fetch", ...);                      // still 5 competitors, 5 bids
it("stores nothing when the portal needs login", async () => {              // reader throws PortalLoginRequiredError
  await post(...).expect(409); expect(await prisma.comparativeStatement.count()).toBe(0);
});
it("stores nothing when the grid cannot be parsed", ...);                   // reader returns [] -> 4xx, count 0
it("refuses a tender that is still SUBMITTED", ...);                        // 400
it("hides another business's competitors", ...);                            // second business sees []
it("an unquoted item keeps that bidder from being lowest overall", ...);    // blank Beta's basic rate -> lowestBidder DELTA ENTERPRISES
```

- [ ] **Step 5: Run** unit + integration tests, `tsc --noEmit` — expect PASS. `grep -rn "captureComparative\|capture-comparative" apps/` returns nothing.
- [ ] **Step 6: Manual check with the owner present** (needs their portal login; ask before running): fetch for tender 1400000013 from the running app, confirm 5 bidders stored. Then one **multi-item** RFx the owner names; compare stored item count with the portal. If rows are missing, fix the scroll loop before continuing.
- [ ] **Step 7: Commit** `feat(competitors): fetch comparative statement from the portal window`.

---

### Task 7: Web — trigger and data hooks

**Files:**
- Create: `apps/web/src/hooks/use-competitors.ts`
- Modify: `apps/web/src/components/tenders/tender-status-tracker.tsx`
- Modify: `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx` (More menu)

**Interfaces:**
- Produces: `useCompetitors()`, `useCompetitor(id)`, `useSetCompetitorSelf(id)`, `useCompetitorItems(search)`, `useItemComparison(itemCode)`, `useRatesToBeat(tenderId, enabled)`, `useFetchComparativeStatement(tenderId)` — each wrapping the Task 5/6 endpoint of the same meaning and returning its DTO; the fetch mutation invalidates `["competitors"]`.

- [ ] **Step 1:** Hooks, following `use-vendors.ts` / `use-portal-bids.ts`.
- [ ] **Step 2:** In `tender-status-tracker.tsx`, in the status mutation's success path: when the new status is `WON` or `LOST` and the user has `tenders:fill_portal`, fire `useFetchComparativeStatement` (do not await it inside the status mutation). Toasts: start "Fetching comparative statement…"; success "Comparative statement saved: {bidders} bidders, {items} items"; error = the server's message, with the hint "You can retry from More → Fetch comparative statement". A failed fetch must leave the status change untouched.
- [ ] **Step 3:** Tender page More menu: for `WON`/`LOST` tenders with `tenders:fill_portal`, add a `DropdownMenuItem` "Fetch comparative statement" calling the same mutation ("Fetching…" while pending). Include it in `hasMoreActions`.
- [ ] **Step 4:** `pnpm --filter @bmp/web lint` and (dev server stopped) `pnpm --filter @bmp/web typecheck` — clean.
- [ ] **Step 5: Commit** `feat(web): fetch comparative statement when a tender is won or lost`.

---

### Task 8: Web — Competitors page

**Files:**
- Modify: `apps/web/src/components/layout/nav-items.ts` — `{ label: "Competitors", href: "/competitors", icon: Swords, permission: "competitors:read" }` after Vendors
- Create: `apps/web/src/app/(dashboard)/competitors/page.tsx` (tabs: "By competitor" list, "By item" list with search)
- Create: `apps/web/src/app/(dashboard)/competitors/[id]/page.tsx` (competitor → items → rates per tender)
- Create: `apps/web/src/app/(dashboard)/competitors/items/[itemCode]/page.tsx` (side-by-side table)
- Create: `apps/web/src/components/competitors/trend-label.tsx`, `lowest-bidder-crown.tsx`

- [ ] **Step 1:** Build to the mockup's screens 2 and 3 using `PageHeader`, `PageSkeleton`, `DataTable`/`Tabs`/`Badge` from `@bmp/ui`, `formatMoney`, `humanize`. Specifics:
  - List columns: Name, SAIL vendor code, Tenders met, Lowest bidder in, Last seen. Our own firm shows a "Us" badge.
  - Competitor detail: header badges vendor code + MSE status; header action (outline) "Mark as our firm" / "Unmark as our firm" behind `confirmAction`, visible with `tenders:fill_portal`. Each item is a collapsible group whose heading shows tender count, `TrendLabel`, and "predicted next {rate}" or "not enough history to predict"; rows: Tender (link), Opened, Qty, Basic rate, Our rate, Rank ("L1 of 5"), crown when `lowestOverall`.
  - By-item page: columns = "Us" first then competitors; one row per tender, newest first; lowest rate in a row in the success colour; crown beside the rate of `lowestOverallCompetitorId`; em dash where a competitor did not bid; final row "Predicted next", muted where `predictedRate` is null (show last rate with a "last" caption).
  - `LowestBidderCrown`: lucide `Crown` icon, `aria-label="Lowest overall bidder"`, same text as tooltip.
  - Empty state: "No comparative statements yet. They are saved when a tender is marked Won or Lost."
- [ ] **Step 2:** Lint + typecheck clean.
- [ ] **Step 3: Commit** `feat(web): competitors page`.

---

### Task 9: Web — rate to beat in the BOQ grid

**Files:**
- Modify: `apps/web/src/components/boq/boq-item-grid.tsx` (the `rate` column, around the `key: "rate"` definition)
- Create: `apps/web/src/components/competitors/rate-to-beat-hint.tsx`, `rate-to-beat-dialog.tsx`
- Modify: the tender BOQ parent that renders `BoqItemGrid`, to call `useRatesToBeat(tenderId, hasPermission(roleName, "competitors:read"))` and pass a `Map<itemCode, RateToBeatDto>` down

- [ ] **Step 1:** `RateToBeatHint` renders under the rate value: "beat {rate} ▾" as a button (`aria-label="Show competitor rates for this item"`); destructive/warning text colour when our rate is above `rateToBeat`, success colour when at or below, muted when our rate is empty; nothing at all when the item has no `itemCode` or no entry; "no history" (muted, not a button) when `rateToBeat` is null. It must not change row height for rows without a hint beyond one text line, and must not interfere with the cell's inline editing (click target is only the hint).
- [ ] **Step 2:** `RateToBeatDialog` (mockup screen 1 popup): title = item description, badge = item code; table Likely bidder / Last rate / Last tender / Tenders / Trend / Predicted next; our row highlighted, labelled "Us"; caption "Rate to beat = lowest predicted next rate among likely bidders."; link "Open in Competitors" → `/competitors/items/{itemCode}`. `DialogClose` "Close".
- [ ] **Step 3:** Above the grid, when `likelyBidders.length > 0`: one line "Likely bidders: A (3 items), B (2 items), …" (top 5, linked).
- [ ] **Step 4:** Lint + typecheck clean; existing BOQ grid tests still pass.
- [ ] **Step 5: Commit** `feat(web): rate to beat in the BOQ grid`.

---

### Task 10: Wrap-up

- [ ] Add a `CLAUDE.md` gotcha: statement is read from the portal window as a cell matrix; needs the logged-in desktop window; the app never logs in; `isSelf` marks our own firm.
- [ ] `pnpm lint`, `pnpm typecheck` (dev server stopped), `pnpm test` — all pass. `graphify update .`
- [ ] Commit `docs: competitor rates notes`.
