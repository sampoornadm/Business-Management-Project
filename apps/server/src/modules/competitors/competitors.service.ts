import type {
  CompetitorDetailDto,
  CompetitorItemDto,
  CompetitorItemSummaryDto,
  CompetitorListItemDto,
  FetchStatementResultDto,
  ItemComparisonDto,
  LikelyBidderDto,
  RateForecastDto,
  RateToBeatDto,
  TenderRatesToBeatDto,
} from "@bmp/types";

import { BadRequestError, NotFoundError } from "../../core/errors/HttpErrors.js";

import type { ParsedStatement } from "./comparative-statement.parser.js";
import type { ICompetitorsRepository, RateRow } from "./competitors.repository.js";
import { forecastRate } from "./rate-trend.js";

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const existing = groups.get(key(row));
    if (existing) existing.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

const newestFirst = (a: RateRow, b: RateRow) => b.openedAt.getTime() - a.openedAt.getTime();

/**
 * Competitor rates read from the client portal's comparative statements. Everything a person
 * sees here beyond the stored rates (rank, trend, predicted rate, rate to beat) is worked out on
 * read from those rates, so a re-fetched or corrected statement can never leave a stale figure.
 */
export class CompetitorsService {
  constructor(
    private readonly competitors: ICompetitorsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(businessId: string): Promise<CompetitorListItemDto[]> {
    return this.competitors.listCompetitors(businessId);
  }

  items(businessId: string, search?: string): Promise<CompetitorItemSummaryDto[]> {
    return this.competitors.listItems(businessId, search);
  }

  async setSelf(businessId: string, id: string, isSelf: boolean): Promise<void> {
    if (!(await this.competitors.findCompetitor(businessId, id))) throw new NotFoundError("Competitor not found");
    await this.competitors.setSelf(businessId, id, isSelf);
  }

  async detail(businessId: string, id: string): Promise<CompetitorDetailDto> {
    const competitor = await this.competitors.findCompetitor(businessId, id);
    if (!competitor) throw new NotFoundError("Competitor not found");
    const own = await this.competitors.ratesByCompetitor(businessId, id);
    const everyone = await this.competitors.ratesByItemCodes(businessId, [...new Set(own.map((row) => row.itemCode))]);
    // Everyone's rate for one item in one tender: what a rank is measured against.
    const field = groupBy(everyone, (row) => `${row.tenderId}|${row.itemCode}`);

    const items = [...groupBy(own, (row) => row.itemCode).values()].map((rows): CompetitorItemDto => {
      const sorted = [...rows].sort(newestFirst);
      const latest = sorted[0]!;
      return {
        itemCode: latest.itemCode,
        description: latest.description,
        unit: latest.unit,
        forecast: this.forecast(rows),
        rates: sorted.map((row) => {
          const rivals = field.get(`${row.tenderId}|${row.itemCode}`) ?? [row];
          return {
            tenderId: row.tenderId,
            tenderNumber: row.tenderNumber,
            openedAt: row.openedAt.toISOString(),
            quantity: row.quantity,
            basicRate: row.basicRate,
            ourRate: rivals.find((rival) => rival.isSelf)?.basicRate ?? null,
            rank: 1 + rivals.filter((rival) => rival.basicRate < row.basicRate).length,
            bidders: rivals.length,
            lowestOverall: row.bidId === row.lowestBidId,
          };
        }),
      };
    });
    items.sort((a, b) => a.description.localeCompare(b.description));

    const byTender = groupBy(own, (row) => row.tenderId);
    const opened = own.map((row) => row.openedAt.getTime());
    return {
      id: competitor.id,
      vendorCode: competitor.vendorCode,
      name: competitor.name,
      isSelf: competitor.isSelf,
      mseStatus: competitor.mseStatus,
      tenderCount: byTender.size,
      lowestCount: [...byTender.values()].filter((rows) => rows[0]!.bidId === rows[0]!.lowestBidId).length,
      lastSeenAt: opened.length > 0 ? new Date(Math.max(...opened)).toISOString() : null,
      items,
    };
  }

  async itemComparison(businessId: string, itemCode: string): Promise<ItemComparisonDto> {
    const rows = await this.competitors.ratesByItemCodes(businessId, [itemCode]);
    if (rows.length === 0) throw new NotFoundError("No competitor has quoted this item");
    const latest = [...rows].sort(newestFirst)[0]!;

    const columns = [...groupBy(rows, (row) => row.competitorId).values()]
      .map((own) => ({
        competitorId: own[0]!.competitorId,
        name: own[0]!.competitorName,
        isSelf: own[0]!.isSelf,
        forecast: this.forecast(own),
      }))
      .sort(
        (a, b) =>
          Number(b.isSelf) - Number(a.isSelf) ||
          a.forecast.lastRate - b.forecast.lastRate ||
          a.name.localeCompare(b.name),
      );

    const tenders = [...groupBy(rows, (row) => row.tenderId).values()].sort((a, b) => newestFirst(a[0]!, b[0]!));
    return {
      itemCode,
      description: latest.description,
      unit: latest.unit,
      columns,
      rows: tenders.map((bids) => ({
        tenderId: bids[0]!.tenderId,
        tenderNumber: bids[0]!.tenderNumber,
        openedAt: bids[0]!.openedAt.toISOString(),
        lowestOverallCompetitorId: bids.find((bid) => bid.bidId === bid.lowestBidId)?.competitorId ?? null,
        rates: Object.fromEntries(bids.map((bid) => [bid.competitorId, bid.basicRate])),
      })),
    };
  }

  /** For pricing a tender: per BOQ item, who is likely to bid and the rate we would need to beat. */
  async ratesToBeat(businessId: string, tenderId: string): Promise<TenderRatesToBeatDto> {
    const tender = await this.competitors.findTender(businessId, tenderId);
    if (!tender) throw new NotFoundError("Tender not found");
    const itemCodes = [...new Set(tender.boqItems.map((item) => item.itemCode))];
    // A tender's own result must not predict itself.
    const rows = (await this.competitors.ratesByItemCodes(businessId, itemCodes)).filter(
      (row) => row.tenderId !== tenderId,
    );
    const byItem = groupBy(rows, (row) => row.itemCode);

    const items = itemCodes.map((itemCode): RateToBeatDto => {
      const bidders = [...groupBy(byItem.get(itemCode) ?? [], (row) => row.competitorId).values()].map((own) => ({
        isSelf: own[0]!.isSelf,
        bidder: this.likelyBidder(own),
      }));
      const others = bidders
        .filter((entry) => !entry.isSelf)
        .map((entry) => entry.bidder)
        .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt) || a.lastRate - b.lastRate);
      const expected = others.map((bidder) => bidder.forecast.predictedRate ?? bidder.lastRate);
      return {
        itemCode,
        rateToBeat: expected.length > 0 ? Math.min(...expected) : null,
        bidders: others,
        us: bidders.find((entry) => entry.isSelf)?.bidder ?? null,
      };
    });

    const likelyBidders = [...groupBy(rows.filter((row) => !row.isSelf), (row) => row.competitorId).values()]
      .map((own) => ({
        competitorId: own[0]!.competitorId,
        name: own[0]!.competitorName,
        itemsQuoted: new Set(own.map((row) => row.itemCode)).size,
      }))
      .sort((a, b) => b.itemsQuoted - a.itemsQuoted || a.name.localeCompare(b.name));

    return { items, likelyBidders, ourFirmKnown: await this.competitors.hasSelf(businessId) };
  }

  /** Saves a statement read from the portal against its tender. Refuses one for another RFx. */
  async store(
    businessId: string,
    tenderId: string,
    statement: ParsedStatement,
    rawGrid: string[][] | null = null,
  ): Promise<FetchStatementResultDto> {
    const tender = await this.competitors.findTender(businessId, tenderId);
    if (!tender) throw new NotFoundError("Tender not found");
    if (statement.rfxNumber !== tender.tenderNumber) {
      throw new BadRequestError(
        `The comparative statement is for RFx ${statement.rfxNumber}, not ${tender.tenderNumber}. Nothing was saved.`,
      );
    }
    const stored = await this.competitors.storeStatement({
      businessId,
      tenderId,
      statement,
      openedAt: statement.bidEnd ?? this.now(),
      usQuotationRef: tender.portalResponseNumber,
      boqItemIdByCode: new Map(tender.boqItems.map((item) => [item.itemCode, item.id])),
      rawGrid,
    });
    return {
      tenderId,
      bidders: stored.bidders,
      items: stored.items,
      lowestBidder: stored.lowestBidder,
      usFound: stored.usFound,
    };
  }

  private forecast(rows: RateRow[]): RateForecastDto {
    // Callers only pass a bidder's non-empty history, so there is always a forecast.
    return forecastRate(
      rows.map((row) => ({ at: row.openedAt, rate: row.basicRate })),
      this.now(),
    )!;
  }

  private likelyBidder(own: RateRow[]): LikelyBidderDto {
    const last = [...own].sort(newestFirst)[0]!;
    return {
      competitorId: last.competitorId,
      name: last.competitorName,
      lastRate: last.basicRate,
      lastTenderNumber: last.tenderNumber,
      lastOpenedAt: last.openedAt.toISOString(),
      tenders: new Set(own.map((row) => row.tenderId)).size,
      forecast: this.forecast(own),
    };
  }
}
