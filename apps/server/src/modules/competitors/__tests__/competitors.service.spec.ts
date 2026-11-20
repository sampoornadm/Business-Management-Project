import { readFileSync } from "node:fs";
import path from "node:path";

import type { CompetitorItemSummaryDto, CompetitorListItemDto } from "@bmp/types";
import { beforeEach, describe, expect, it } from "vitest";

import { BadRequestError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import { parseComparativeMatrix } from "../comparative-statement.parser.js";
import type {
  CompetitorRecord,
  ICompetitorsRepository,
  RateRow,
  StatementSummary,
  StoredStatement,
  StoreStatementInput,
  TenderForStatement,
} from "../competitors.repository.js";
import { CompetitorsService } from "../competitors.service.js";

const BIZ = "biz-1";
const SELF = "c-self";
const BETA = "c-beta";
const DELTA = "c-nrg";
const GAMMA = "c-national";
const EPSILON = "c-epsilon";
const COIL = "20110601001260";
const NAMES: Record<string, string> = {
  [SELF]: "ALPHA SPRING WORKS",
  [BETA]: "BETA ENGINEERING CORPORATION",
  [DELTA]: "DELTA ENTERPRISES",
  [GAMMA]: "GAMMA ENGINEERING WORKS",
  [EPSILON]: "EPSILON INDUSTRIES",
};
const TENDERS = {
  "1400000001": { opened: "2025-08-02", lowest: GAMMA },
  "1400000002": { opened: "2026-03-11", lowest: BETA },
  "1400000013": { opened: "2026-10-23", lowest: BETA },
} as const;
type TenderNumber = keyof typeof TENDERS;

function row(competitorId: string, tenderNumber: TenderNumber, basicRate: number, itemCode = COIL): RateRow {
  const tender = TENDERS[tenderNumber];
  return {
    competitorId,
    competitorName: NAMES[competitorId]!,
    isSelf: competitorId === SELF,
    itemCode,
    description: itemCode === COIL ? "COIL SPRING,PSL-1397,MK-20" : `ITEM ${itemCode}`,
    unit: "EA",
    quantity: 3300,
    basicRate,
    tenderId: `tender-${tenderNumber}`,
    tenderNumber,
    openedAt: new Date(tender.opened),
    statementId: `statement-${tenderNumber}`,
    bidId: `bid-${tenderNumber}-${competitorId}`,
    lowestBidId: `bid-${tenderNumber}-${tender.lowest}`,
  };
}

const ROWS: RateRow[] = [
  row(BETA, "1400000001", 168.5),
  row(GAMMA, "1400000001", 165),
  row(BETA, "1400000002", 163.5),
  row(DELTA, "1400000002", 170),
  row(GAMMA, "1400000002", 204),
  row(SELF, "1400000002", 310),
  row(BETA, "1400000002", 55, "CODE-B"),
  row(BETA, "1400000013", 160),
  row(DELTA, "1400000013", 170),
  row(GAMMA, "1400000013", 185),
  row(SELF, "1400000013", 270),
  row(EPSILON, "1400000013", 50, "CODE-B"),
];

class FakeCompetitorsRepository implements ICompetitorsRepository {
  rows: RateRow[] = ROWS;
  tenders = new Map<string, TenderForStatement>();
  stored: StoreStatementInput[] = [];
  selfKnown = true;
  summaries = new Map<string, StatementSummary>();
  findStatementSummary(_businessId: string, tenderId: string) {
    return Promise.resolve(this.summaries.get(tenderId) ?? null);
  }
  hasSelf() {
    return Promise.resolve(this.selfKnown);
  }
  selfCalls: [string, boolean][] = [];

  findTender(_businessId: string, tenderId: string) {
    return Promise.resolve(this.tenders.get(tenderId) ?? null);
  }
  storeStatement(input: StoreStatementInput): Promise<StoredStatement> {
    this.stored.push(input);
    return Promise.resolve({ statementId: "s-1", bidders: 5, items: 1, lowestBidder: "BETA ENGINEERING CORPORATION", usFound: true });
  }
  listCompetitors(): Promise<CompetitorListItemDto[]> {
    return Promise.resolve([]);
  }
  findCompetitor(_businessId: string, id: string): Promise<CompetitorRecord | null> {
    const name = NAMES[id];
    return Promise.resolve(
      name ? { id, vendorCode: `code-${id}`, name, isSelf: id === SELF, mseStatus: "MSE-GENERAL" } : null,
    );
  }
  setSelf(_businessId: string, id: string, isSelf: boolean) {
    this.selfCalls.push([id, isSelf]);
    return Promise.resolve();
  }
  ratesByCompetitor(_businessId: string, competitorId: string) {
    return Promise.resolve(this.rows.filter((r) => r.competitorId === competitorId));
  }
  ratesByItemCodes(_businessId: string, itemCodes: string[]) {
    return Promise.resolve(this.rows.filter((r) => itemCodes.includes(r.itemCode)));
  }
  listItems(): Promise<CompetitorItemSummaryDto[]> {
    return Promise.resolve([]);
  }
}

const NOW = new Date("2026-11-14T00:00:00Z");
const NEW_TENDER: TenderForStatement = {
  id: "tender-new",
  tenderNumber: "1400000017",
  status: "DRAFT",
  evaluationCriteria: null,
  businessName: "Alpha Spring Works",
  portalResponseNumber: null,
  boqItems: [
    { id: "boq-a", itemCode: COIL },
    { id: "boq-b", itemCode: "CODE-B" },
    { id: "boq-c", itemCode: "CODE-NONE" },
  ],
};

let repository: FakeCompetitorsRepository;
let service: CompetitorsService;

beforeEach(() => {
  repository = new FakeCompetitorsRepository();
  repository.tenders.set(NEW_TENDER.id, NEW_TENDER);
  service = new CompetitorsService(repository, () => NOW);
});

describe("CompetitorsService.detail", () => {
  it("ranks a competitor's rate within each tender and flags the lowest overall bidder", async () => {
    const detail = await service.detail(BIZ, BETA);
    const coil = detail.items.find((item) => item.itemCode === COIL)!;
    expect(coil.rates.map((rate) => rate.tenderNumber)).toEqual(["1400000013", "1400000002", "1400000001"]);
    expect(coil.rates[0]).toMatchObject({ basicRate: 160, ourRate: 270, rank: 1, bidders: 4, lowestOverall: true });
    expect(coil.rates[2]).toMatchObject({ basicRate: 168.5, ourRate: null, rank: 2, bidders: 2, lowestOverall: false });
    expect(coil.forecast).toMatchObject({ lastRate: 160, direction: "FALLING", points: 3 });
    expect(detail).toMatchObject({ name: NAMES[BETA], tenderCount: 3, lowestCount: 2, mseStatus: "MSE-GENERAL" });
    expect(detail.lastSeenAt).toBe("2026-10-23T00:00:00.000Z");
  });

  it("does not predict for an item quoted once", async () => {
    const detail = await service.detail(BIZ, EPSILON);
    expect(detail.items[0]!.forecast).toEqual({ lastRate: 50, predictedRate: null, direction: null, points: 1 });
  });

  it("404s for a competitor of another business", async () => {
    await expect(service.detail(BIZ, "c-unknown")).rejects.toThrow(NotFoundError);
  });
});

describe("CompetitorsService.itemComparison", () => {
  it("puts our own firm first, then the others by latest rate", async () => {
    const comparison = await service.itemComparison(BIZ, COIL);
    expect(comparison.columns.map((column) => column.competitorId)).toEqual([SELF, BETA, DELTA, GAMMA]);
    expect(comparison.columns[0]!.isSelf).toBe(true);
    expect(comparison.description).toBe("COIL SPRING,PSL-1397,MK-20");
  });

  it("lists tenders newest first with every bidder's rate and the lowest overall bidder", async () => {
    const { rows } = await service.itemComparison(BIZ, COIL);
    expect(rows.map((r) => r.tenderNumber)).toEqual(["1400000013", "1400000002", "1400000001"]);
    expect(rows[0]).toMatchObject({ lowestOverallCompetitorId: BETA, rates: { [SELF]: 270, [BETA]: 160, [DELTA]: 170 } });
    expect(rows[2]!.lowestOverallCompetitorId).toBe(GAMMA);
    expect(rows[2]!.rates).toEqual({ [BETA]: 168.5, [GAMMA]: 165 });
  });

  it("404s for an item nobody has quoted", async () => {
    await expect(service.itemComparison(BIZ, "CODE-NONE")).rejects.toThrow(NotFoundError);
  });
});

describe("CompetitorsService.ratesToBeat", () => {
  it("never lists our own firm as a competitor to beat", async () => {
    const { items } = await service.ratesToBeat(BIZ, NEW_TENDER.id);
    expect(items[0]!.itemCode).toBe(COIL);
    expect(items[0]!.bidders.map((bidder) => bidder.competitorId).sort()).toEqual([GAMMA, DELTA, BETA].sort());
    expect(items[0]!.us).toMatchObject({ lastRate: 270, lastTenderNumber: "1400000013", tenders: 2 });
  });

  it("is the lowest predicted rate among likely bidders", async () => {
    const { items } = await service.ratesToBeat(BIZ, NEW_TENDER.id);
    const beta = items[0]!.bidders.find((bidder) => bidder.competitorId === BETA)!;
    expect(beta.forecast.predictedRate).not.toBeNull();
    expect(beta.forecast.predictedRate).toBeLessThan(160);
    expect(items[0]!.rateToBeat).toBe(beta.forecast.predictedRate);
  });

  it("falls back to the last rate when a bidder has quoted only once", async () => {
    const { items } = await service.ratesToBeat(BIZ, NEW_TENDER.id);
    expect(items[1]).toMatchObject({ itemCode: "CODE-B", rateToBeat: 50 });
    expect(items[1]!.bidders.every((bidder) => bidder.forecast.predictedRate === null)).toBe(true);
  });

  it("has no rate to beat for an item nobody has quoted", async () => {
    const { items } = await service.ratesToBeat(BIZ, NEW_TENDER.id);
    expect(items[2]).toEqual({ itemCode: "CODE-NONE", rateToBeat: null, bidders: [], us: null });
  });

  it("does not use the tender's own statement", async () => {
    repository.tenders.set("tender-1400000013", {
      ...NEW_TENDER,
      id: "tender-1400000013",
      tenderNumber: "1400000013",
      boqItems: [{ id: "boq-a", itemCode: COIL }],
    });
    const { items } = await service.ratesToBeat(BIZ, "tender-1400000013");
    const beta = items[0]!.bidders.find((bidder) => bidder.competitorId === BETA)!;
    expect(beta).toMatchObject({ lastRate: 163.5, lastTenderNumber: "1400000002", tenders: 2 });
  });

  it("ranks likely bidders by how many of the tender's items they have quoted", async () => {
    const { likelyBidders } = await service.ratesToBeat(BIZ, NEW_TENDER.id);
    expect(likelyBidders[0]).toEqual({ competitorId: BETA, name: NAMES[BETA], itemsQuoted: 2 });
    expect(likelyBidders.map((bidder) => bidder.competitorId)).not.toContain(SELF);
    expect(likelyBidders).toHaveLength(4);
  });

  it("says when no portal vendor is marked as our own firm yet", async () => {
    expect((await service.ratesToBeat(BIZ, NEW_TENDER.id)).ourFirmKnown).toBe(true);
    repository.rows = ROWS.map((r) => ({ ...r, isSelf: false }));
    repository.selfKnown = false;
    expect((await service.ratesToBeat(BIZ, NEW_TENDER.id)).ourFirmKnown).toBe(false);
  });

  it("lists each BOQ item code once", async () => {
    repository.tenders.set("tender-dup", {
      ...NEW_TENDER,
      id: "tender-dup",
      boqItems: [
        { id: "boq-a", itemCode: COIL },
        { id: "boq-a2", itemCode: COIL },
      ],
    });
    expect((await service.ratesToBeat(BIZ, "tender-dup")).items).toHaveLength(1);
  });

  it("404s for an unknown tender", async () => {
    await expect(service.ratesToBeat(BIZ, "tender-missing")).rejects.toThrow(NotFoundError);
  });
});

describe("CompetitorsService.store", () => {
  const parsed = parseComparativeMatrix(
    JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "comparative-1400000013.matrix.json"), "utf8"),
    ) as string[][],
  );
  const lostTender: TenderForStatement = {
    id: "tender-351",
    tenderNumber: "1400000013",
    status: "LOST",
    evaluationCriteria: null,
    businessName: "Some Other Trading Co",
    portalResponseNumber: "8100000002",
    boqItems: [{ id: "boq-coil", itemCode: COIL }],
  };

  it("links items to the current BOQ by item code and finds us by response number", async () => {
    repository.tenders.set(lostTender.id, lostTender);
    const result = await service.store(BIZ, lostTender.id, parsed);
    const input = repository.stored[0]!;
    // 8100000002 is Beta's quotation reference on this statement.
    expect(input).toMatchObject({ businessId: BIZ, tenderId: "tender-351", usVendorCode: "1000000002" });
    expect(input.boqItemIdByCode.get(COIL)).toBe("boq-coil");
    expect(input.openedAt.toISOString()).toBe("2026-10-23T09:30:00.000Z");
    expect(result).toEqual({
      tenderId: "tender-351",
      bidders: 5,
      items: 1,
      lowestBidder: "BETA ENGINEERING CORPORATION",
      usFound: true,
    });
  });

  it("passes no quotation reference when the bid was not filled through the app", async () => {
    repository.tenders.set(lostTender.id, { ...lostTender, portalResponseNumber: null });
    await service.store(BIZ, lostTender.id, parsed);
    expect(repository.stored[0]!.usVendorCode).toBeNull();
  });

  it("finds us by business name when no firm is marked as ours yet", async () => {
    repository.selfKnown = false;
    repository.tenders.set(lostTender.id, {
      ...lostTender,
      portalResponseNumber: null,
      businessName: "Epsilon Industries",
    });
    await service.store(BIZ, lostTender.id, parsed);
    expect(repository.stored[0]!.usVendorCode).toBe("1000000005");
  });

  it("matches the business name loosely on case, punctuation and '&' but not on a different firm", async () => {
    repository.selfKnown = false;
    repository.tenders.set(lostTender.id, {
      ...lostTender,
      portalResponseNumber: null,
      businessName: "alpha spring works",
    });
    await service.store(BIZ, lostTender.id, parsed);
    expect(repository.stored[0]!.usVendorCode).toBe("1000000001");

    repository.tenders.set(lostTender.id, { ...lostTender, portalResponseNumber: null, businessName: "Alpha" });
    await service.store(BIZ, lostTender.id, parsed);
    expect(repository.stored[1]!.usVendorCode).toBeNull();
  });

  it("does not guess by name once a firm is already marked as ours", async () => {
    repository.selfKnown = true;
    repository.tenders.set(lostTender.id, {
      ...lostTender,
      portalResponseNumber: null,
      businessName: "Epsilon Industries",
    });
    await service.store(BIZ, lostTender.id, parsed);
    expect(repository.stored[0]!.usVendorCode).toBeNull();
  });

  it("uses the fetch time when the statement has no bid end date", async () => {
    repository.tenders.set(lostTender.id, lostTender);
    await service.store(BIZ, lostTender.id, { ...parsed, bidEnd: null });
    expect(repository.stored[0]!.openedAt).toEqual(NOW);
  });

  it("rejects a statement for a different RFx and stores nothing", async () => {
    repository.tenders.set("tender-481", { ...lostTender, id: "tender-481", tenderNumber: "1400000016" });
    await expect(service.store(BIZ, "tender-481", parsed)).rejects.toThrow(BadRequestError);
    await expect(service.store(BIZ, "tender-481", parsed)).rejects.toThrow(/1400000013/);
    expect(repository.stored).toEqual([]);
  });

  it("404s for an unknown tender", async () => {
    await expect(service.store(BIZ, "tender-missing", parsed)).rejects.toThrow(NotFoundError);
  });
});

describe("CompetitorsService.standing", () => {
  const bid = (competitorId: string, total: number | null, itemsQuoted = 1, isSelf = false) => ({
    bidId: `bid-${competitorId}`,
    competitorId,
    name: NAMES[competitorId]!,
    isSelf,
    total,
    deliveryText: null,
    items: Array.from({ length: itemsQuoted }, (_unused, index) => ({
      slNo: `00${index + 1}`,
      itemCode: `CODE-${index + 1}`,
      description: `ITEM ${index + 1}`,
      unit: "EA",
      quantity: 10,
      basicRate: (total ?? 0) / 10,
    })),
  });
  const summary = (bids: ReturnType<typeof bid>[], lowest: string | null = BETA) => ({
    fetchedAt: new Date("2026-10-24T05:00:00Z"),
    rfxNumber: "1400000013",
    basisOfEvaluation: "Overall",
    lowestBidId: lowest ? `bid-${lowest}` : null,
    itemCount: 1,
    bids,
  });

  it("is null before a statement has been fetched", async () => {
    expect(await service.standing(BIZ, "tender-x")).toBeNull();
  });

  it("gives our rank by total and the lowest bidder", async () => {
    repository.summaries.set(
      "tender-x",
      summary([bid(SELF, 891000, 1, true), bid(BETA, 528000), bid(GAMMA, 610500), bid(DELTA, 561000), bid(EPSILON, 940500)]),
    );
    expect(await service.standing(BIZ, "tender-x")).toEqual({
      fetchedAt: "2026-10-24T05:00:00.000Z",
      basisOfEvaluation: "Overall",
      bidders: 5,
      usIdentified: true,
      ourRank: 4,
      ourTotal: 891000,
      lowest: { competitorId: BETA, name: NAMES[BETA], total: 528000, isSelf: false },
    });
  });

  it("ranks us first when ours is the lowest total", async () => {
    repository.summaries.set("tender-x", summary([bid(SELF, 500, 1, true), bid(BETA, 600)], SELF));
    const standing = await service.standing(BIZ, "tender-x");
    expect(standing).toMatchObject({ ourRank: 1, lowest: { competitorId: SELF, isSelf: true } });
  });

  it("does not rank us against bidders who skipped items", async () => {
    const two = { ...summary([bid(SELF, 900, 2, true), bid(BETA, 100, 1), bid(DELTA, 800, 2)], DELTA), itemCount: 2 };
    repository.summaries.set("tender-x", two);
    expect(await service.standing(BIZ, "tender-x")).toMatchObject({ ourRank: 2, bidders: 3 });
  });

  it("has no rank when our bid is not identified or does not cover every item", async () => {
    repository.summaries.set("tender-x", summary([bid(BETA, 528000), bid(DELTA, 561000)]));
    expect(await service.standing(BIZ, "tender-x")).toMatchObject({ usIdentified: false, ourRank: null, ourTotal: null });
    repository.summaries.set("tender-y", { ...summary([bid(SELF, 50, 1, true), bid(BETA, 600, 2)]), itemCount: 2 });
    expect(await service.standing(BIZ, "tender-y")).toMatchObject({ usIdentified: true, ourRank: null, ourTotal: 50 });
  });
});

describe("CompetitorsService.statement", () => {
  const item = (slNo: string, itemCode: string, basicRate: number) => ({
    slNo,
    itemCode,
    description: `ITEM ${itemCode}`,
    unit: "EA",
    quantity: 10,
    basicRate,
  });
  const bid = (competitorId: string, total: number | null, items: ReturnType<typeof item>[], deliveryText: string | null = null) => ({
    bidId: `bid-${competitorId}`,
    competitorId,
    name: NAMES[competitorId]!,
    isSelf: competitorId === SELF,
    total,
    deliveryText,
    items,
  });
  const stored = {
    fetchedAt: new Date("2026-10-24T05:00:00Z"),
    rfxNumber: "1400000015",
    basisOfEvaluation: "Overall",
    lowestBidId: `bid-${DELTA}`,
    itemCount: 3,
    bids: [
      // Stored out of order on purpose, items too.
      bid(BETA, 900, [item("003", "C", 30), item("001", "A", 10), item("002", "B", 20)], "240"),
      bid(SELF, 800, [item("002", "B", 21), item("001", "A", 12), item("003", "C", 25)]),
      bid(DELTA, 700, [item("001", "A", 9), item("002", "B", 25), item("003", "C", 26)]),
      bid(EPSILON, 100, [item("010", "J", 5)]),
    ],
  };

  it("is null before a statement has been fetched", async () => {
    expect(await service.statement(BIZ, "tender-x")).toBeNull();
  });

  it("puts our bid first, then the others by total, partial bids last", async () => {
    repository.summaries.set("tender-x", stored);
    const statement = (await service.statement(BIZ, "tender-x"))!;
    expect(statement.bidders.map((b) => [b.competitorId, b.rank, b.lowestOverall])).toEqual([
      [SELF, 2, false],
      [DELTA, 1, true],
      [BETA, 3, false],
      [EPSILON, null, false],
    ]);
    expect(statement.bidders[2]).toMatchObject({ name: NAMES[BETA], total: 900, deliveryText: "240", isSelf: false });
    expect(statement).toMatchObject({ rfxNumber: "1400000015", fetchedAt: "2026-10-24T05:00:00.000Z" });
  });

  it("lists items in the statement's own serial order with every bidder's rate", async () => {
    repository.summaries.set("tender-x", stored);
    const { items } = (await service.statement(BIZ, "tender-x"))!;
    expect(items.map((i) => [i.slNo, i.itemCode])).toEqual([
      ["001", "A"],
      ["002", "B"],
      ["003", "C"],
      ["010", "J"],
    ]);
    expect(items[0]).toMatchObject({ description: "ITEM A", unit: "EA", quantity: 10 });
    expect(items[0]!.rates).toEqual({ [SELF]: 12, [DELTA]: 9, [BETA]: 10 });
    expect(items[3]!.rates).toEqual({ [EPSILON]: 5 });
  });
});

describe("CompetitorsService.setSelf", () => {
  it("marks a competitor as our own firm", async () => {
    await service.setSelf(BIZ, BETA, true);
    expect(repository.selfCalls).toEqual([[BETA, true]]);
  });

  it("404s for an unknown competitor", async () => {
    await expect(service.setSelf(BIZ, "c-unknown", true)).rejects.toThrow(NotFoundError);
  });
});
