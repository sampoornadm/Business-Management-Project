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
    portalResponseNumber: "8100000002",
    boqItems: [{ id: "boq-coil", itemCode: COIL }],
  };

  it("links items to the current BOQ by item code and finds us by response number", async () => {
    repository.tenders.set(lostTender.id, lostTender);
    const result = await service.store(BIZ, lostTender.id, parsed);
    const input = repository.stored[0]!;
    expect(input).toMatchObject({ businessId: BIZ, tenderId: "tender-351", usQuotationRef: "8100000002" });
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
    expect(repository.stored[0]!.usQuotationRef).toBeNull();
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

describe("CompetitorsService.setSelf", () => {
  it("marks a competitor as our own firm", async () => {
    await service.setSelf(BIZ, BETA, true);
    expect(repository.selfCalls).toEqual([[BETA, true]]);
  });

  it("404s for an unknown competitor", async () => {
    await expect(service.setSelf(BIZ, "c-unknown", true)).rejects.toThrow(NotFoundError);
  });
});
