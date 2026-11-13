import type { Prisma, PrismaClient } from "@bmp/database";
import type { CompetitorItemSummaryDto, CompetitorListItemDto } from "@bmp/types";

import type { ParsedBid, ParsedStatement } from "./comparative-statement.parser.js";

export interface StoreStatementInput {
  businessId: string;
  tenderId: string;
  statement: ParsedStatement;
  openedAt: Date;
  /** Our own quotation reference number on the portal, when the app knows it. */
  usQuotationRef: string | null;
  /** Current BOQ lines by portal item code, to link a competitor's rate to our own line. */
  boqItemIdByCode: Map<string, string>;
}

export interface StoredStatement {
  statementId: string;
  bidders: number;
  items: number;
  lowestBidder: string | null;
  usFound: boolean;
}

/** One bidder's rate for one item in one tender, with what is needed to rank and chart it. */
export interface RateRow {
  competitorId: string;
  competitorName: string;
  isSelf: boolean;
  itemCode: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  basicRate: number;
  tenderId: string;
  tenderNumber: string;
  openedAt: Date;
  statementId: string;
  bidId: string;
  lowestBidId: string | null;
}

export interface CompetitorRecord {
  id: string;
  vendorCode: string;
  name: string;
  isSelf: boolean;
  mseStatus: string | null;
}

export interface TenderForStatement {
  id: string;
  tenderNumber: string;
  status: string;
  /** Our response number on the SAIL ISP portal, saved when the bid was filled through the app. */
  portalResponseNumber: string | null;
  /** Item-coded lines of the tender's current BOQ. */
  boqItems: { id: string; itemCode: string }[];
}

export interface ICompetitorsRepository {
  findTender(businessId: string, tenderId: string): Promise<TenderForStatement | null>;
  storeStatement(input: StoreStatementInput): Promise<StoredStatement>;
  listCompetitors(businessId: string): Promise<CompetitorListItemDto[]>;
  findCompetitor(businessId: string, id: string): Promise<CompetitorRecord | null>;
  setSelf(businessId: string, id: string, isSelf: boolean): Promise<void>;
  ratesByCompetitor(businessId: string, competitorId: string): Promise<RateRow[]>;
  /** Every bidder's rates for these items, our own firm included. */
  ratesByItemCodes(businessId: string, itemCodes: string[]): Promise<RateRow[]>;
  listItems(businessId: string, search?: string): Promise<CompetitorItemSummaryDto[]>;
}

/**
 * The lowest overall quote: smallest total among bidders who quoted every item (a bidder who
 * skipped an item has a smaller total for the wrong reason). Returns an index into `bids`.
 */
export function lowestOverallIndex(bids: Pick<ParsedBid, "total" | "items">[]): number | null {
  const fullCount = Math.max(0, ...bids.map((bid) => bid.items.length));
  let lowest: number | null = null;
  bids.forEach((bid, index) => {
    if (bid.total === null || bid.items.length === 0 || bid.items.length < fullCount) return;
    if (lowest === null || bid.total < bids[lowest]!.total!) lowest = index;
  });
  return lowest;
}

const rateRowInclude = {
  bid: {
    include: {
      competitor: true,
      statement: { include: { tender: { select: { tenderNumber: true } } } },
    },
  },
} satisfies Prisma.ComparativeBidItemInclude;

type RateRowRecord = Prisma.ComparativeBidItemGetPayload<{ include: typeof rateRowInclude }>;

function toRateRow(item: RateRowRecord): RateRow {
  const { bid } = item;
  return {
    competitorId: bid.competitorId,
    competitorName: bid.competitor.name,
    isSelf: bid.competitor.isSelf,
    itemCode: item.itemCode,
    description: item.description,
    unit: item.unit,
    quantity: item.rfqQuantity,
    basicRate: item.basicRate,
    tenderId: bid.statement.tenderId,
    tenderNumber: bid.statement.tender.tenderNumber,
    openedAt: bid.statement.openedAt,
    statementId: bid.statementId,
    bidId: bid.id,
    lowestBidId: bid.statement.lowestBidId,
  };
}

export class CompetitorsRepository implements ICompetitorsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findTender(businessId: string, tenderId: string): Promise<TenderForStatement | null> {
    const tender = await this.prisma.tender.findFirst({
      where: { id: tenderId, businessId },
      select: {
        id: true,
        tenderNumber: true,
        status: true,
        portalBids: { where: { portalCode: "SAIL_ISP" }, select: { responseNumber: true } },
        boqs: {
          where: { isCurrent: true },
          select: { items: { where: { itemCode: { not: null } }, select: { id: true, itemCode: true } } },
        },
      },
    });
    if (!tender) return null;
    return {
      id: tender.id,
      tenderNumber: tender.tenderNumber,
      status: tender.status,
      portalResponseNumber: tender.portalBids[0]?.responseNumber ?? null,
      boqItems: tender.boqs.flatMap((boq) =>
        boq.items.flatMap((item) => (item.itemCode ? [{ id: item.id, itemCode: item.itemCode }] : [])),
      ),
    };
  }

  async storeStatement(input: StoreStatementInput): Promise<StoredStatement> {
    const { businessId, tenderId, statement } = input;
    return this.prisma.$transaction(async (tx) => {
      // Re-fetching replaces the tender's statement; bids and items go with it (cascade).
      await tx.comparativeStatement.deleteMany({ where: { businessId, tenderId } });
      const created = await tx.comparativeStatement.create({
        data: {
          businessId,
          tenderId,
          rfxNumber: statement.rfxNumber,
          description: statement.description,
          openedAt: input.openedAt,
          basisOfEvaluation: statement.basisOfEvaluation,
        },
      });

      const lowestIndex = lowestOverallIndex(statement.bids);
      let lowestBidId: string | null = null;
      let usFound = false;
      for (const [index, bid] of statement.bids.entries()) {
        const matchedByRef = input.usQuotationRef !== null && bid.quotationRef === input.usQuotationRef;
        const competitor = await tx.competitor.upsert({
          where: { businessId_vendorCode: { businessId, vendorCode: bid.vendorCode } },
          create: { businessId, vendorCode: bid.vendorCode, name: bid.vendorName, isSelf: matchedByRef },
          // A quotation-reference match teaches us which portal vendor is our own firm.
          update: { name: bid.vendorName, ...(matchedByRef ? { isSelf: true } : {}) },
        });
        usFound ||= competitor.isSelf;
        const createdBid = await tx.comparativeBid.create({
          data: {
            businessId,
            statementId: created.id,
            competitorId: competitor.id,
            isUs: competitor.isSelf,
            quotationRef: bid.quotationRef,
            submittedBy: bid.submittedBy,
            total: bid.total,
            deliveryText: bid.deliveryText,
            mseStatus: bid.mseStatus,
            answers: bid.answers,
            items: {
              create: bid.items.map((item) => ({
                businessId,
                itemCode: item.itemCode,
                description: item.description,
                unit: item.unit,
                rfqQuantity: item.rfqQuantity,
                offerQuantity: item.offerQuantity,
                basicRate: item.basicRate,
                landedRate: item.landedRate,
                boqItemId: input.boqItemIdByCode.get(item.itemCode) ?? null,
              })),
            },
          },
        });
        if (index === lowestIndex) lowestBidId = createdBid.id;
      }
      if (lowestBidId) {
        await tx.comparativeStatement.updateMany({ where: { id: created.id, businessId }, data: { lowestBidId } });
      }

      return {
        statementId: created.id,
        bidders: statement.bids.length,
        items: new Set(statement.bids.flatMap((bid) => bid.items.map((item) => item.itemCode))).size,
        lowestBidder: lowestIndex === null ? null : statement.bids[lowestIndex]!.vendorName,
        usFound,
      };
    });
  }

  async listCompetitors(businessId: string): Promise<CompetitorListItemDto[]> {
    const competitors = await this.prisma.competitor.findMany({
      where: { businessId },
      orderBy: { name: "asc" },
      include: { bids: { select: { id: true, statement: { select: { openedAt: true, lowestBidId: true } } } } },
    });
    return competitors.map((competitor) => {
      const opened = competitor.bids.map((bid) => bid.statement.openedAt.getTime());
      return {
        id: competitor.id,
        vendorCode: competitor.vendorCode,
        name: competitor.name,
        isSelf: competitor.isSelf,
        tenderCount: competitor.bids.length,
        lowestCount: competitor.bids.filter((bid) => bid.statement.lowestBidId === bid.id).length,
        lastSeenAt: opened.length > 0 ? new Date(Math.max(...opened)).toISOString() : null,
      };
    });
  }

  async findCompetitor(businessId: string, id: string): Promise<CompetitorRecord | null> {
    const competitor = await this.prisma.competitor.findFirst({
      where: { id, businessId },
      include: { bids: { orderBy: { statement: { openedAt: "desc" } }, take: 1, select: { mseStatus: true } } },
    });
    if (!competitor) return null;
    return {
      id: competitor.id,
      vendorCode: competitor.vendorCode,
      name: competitor.name,
      isSelf: competitor.isSelf,
      mseStatus: competitor.bids[0]?.mseStatus ?? null,
    };
  }

  async setSelf(businessId: string, id: string, isSelf: boolean): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.competitor.updateMany({ where: { id, businessId }, data: { isSelf } }),
      this.prisma.comparativeBid.updateMany({ where: { competitorId: id, businessId }, data: { isUs: isSelf } }),
    ]);
  }

  async ratesByCompetitor(businessId: string, competitorId: string): Promise<RateRow[]> {
    const items = await this.prisma.comparativeBidItem.findMany({
      where: { businessId, bid: { competitorId } },
      include: rateRowInclude,
    });
    return items.map(toRateRow);
  }

  async ratesByItemCodes(businessId: string, itemCodes: string[]): Promise<RateRow[]> {
    if (itemCodes.length === 0) return [];
    const items = await this.prisma.comparativeBidItem.findMany({
      where: { businessId, itemCode: { in: itemCodes } },
      include: rateRowInclude,
    });
    return items.map(toRateRow);
  }

  async listItems(businessId: string, search?: string): Promise<CompetitorItemSummaryDto[]> {
    const term = search?.trim();
    // ponytail: aggregates in memory over every stored rate; move to a GROUP BY once a business
    // holds enough statements for this list to feel slow.
    const items = await this.prisma.comparativeBidItem.findMany({
      where: {
        businessId,
        ...(term
          ? {
              OR: [
                { description: { contains: term, mode: "insensitive" as const } },
                { itemCode: { contains: term } },
              ],
            }
          : {}),
      },
      select: { itemCode: true, description: true, bid: { select: { competitorId: true, statementId: true } } },
    });
    const byCode = new Map<string, { description: string; competitors: Set<string>; tenders: Set<string> }>();
    for (const item of items) {
      const entry = byCode.get(item.itemCode) ?? {
        description: item.description,
        competitors: new Set<string>(),
        tenders: new Set<string>(),
      };
      entry.competitors.add(item.bid.competitorId);
      entry.tenders.add(item.bid.statementId);
      byCode.set(item.itemCode, entry);
    }
    return [...byCode.entries()]
      .map(([itemCode, entry]) => ({
        itemCode,
        description: entry.description,
        competitorCount: entry.competitors.size,
        tenderCount: entry.tenders.size,
      }))
      .sort((a, b) => a.description.localeCompare(b.description));
  }
}
