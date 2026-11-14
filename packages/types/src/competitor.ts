import type { TenderStatus } from "./tender.js";

// Competitor rates read from the client portal's comparative statement (SAIL ISP). All rates
// are the basic price per unit unless a field says otherwise.

/**
 * SAIL ISP numbers its RFx with ten digits, and that number is the tender number here. Tenders
 * from other clients (and budgetary quotations) have no comparative statement on that portal.
 */
export function isSailRfxNumber(tenderNumber: string): boolean {
  return /^\d{10}$/.test(tenderNumber);
}

export type TrendDirection = "RISING" | "FALLING" | "FLAT";

export interface RateForecastDto {
  lastRate: number;
  /** Null until there are at least two past quotes; always shown as "predicted", never as fact. */
  predictedRate: number | null;
  direction: TrendDirection | null;
  points: number;
}

export interface CompetitorListItemDto {
  id: string;
  vendorCode: string;
  name: string;
  /** Our own firm as the portal lists it. */
  isSelf: boolean;
  tenderCount: number;
  /** Tenders in which this firm's overall quote was the lowest. */
  lowestCount: number;
  lastSeenAt: string | null;
}

export interface CompetitorRateRowDto {
  tenderId: string;
  tenderNumber: string;
  openedAt: string;
  quantity: number | null;
  basicRate: number;
  ourRate: number | null;
  /** 1 = lowest rate for this item in this tender. */
  rank: number;
  bidders: number;
  /** This firm's overall quote was the lowest in this tender (not necessarily who was awarded). */
  lowestOverall: boolean;
}

export interface CompetitorItemDto {
  itemCode: string;
  description: string;
  unit: string | null;
  forecast: RateForecastDto;
  /** Newest tender first. */
  rates: CompetitorRateRowDto[];
}

export interface CompetitorDetailDto extends CompetitorListItemDto {
  mseStatus: string | null;
  items: CompetitorItemDto[];
}

export interface ItemComparisonColumnDto {
  competitorId: string;
  name: string;
  isSelf: boolean;
  forecast: RateForecastDto;
}

export interface ItemComparisonRowDto {
  tenderId: string;
  tenderNumber: string;
  openedAt: string;
  lowestOverallCompetitorId: string | null;
  /** competitorId -> basic rate; a firm that did not bid has no entry. */
  rates: Record<string, number>;
}

export interface ItemComparisonDto {
  itemCode: string;
  description: string;
  unit: string | null;
  /** Our own firm first, then the others by their latest rate, lowest first. */
  columns: ItemComparisonColumnDto[];
  /** Newest tender first. */
  rows: ItemComparisonRowDto[];
}

export interface CompetitorItemSummaryDto {
  itemCode: string;
  description: string;
  competitorCount: number;
  tenderCount: number;
}

export interface LikelyBidderDto {
  competitorId: string;
  name: string;
  lastRate: number;
  lastTenderNumber: string;
  lastOpenedAt: string;
  tenders: number;
  forecast: RateForecastDto;
}

export interface RateToBeatDto {
  itemCode: string;
  /** Lowest predicted (or, with thin history, last) rate among likely bidders; null with no history. */
  rateToBeat: number | null;
  bidders: LikelyBidderDto[];
  us: LikelyBidderDto | null;
}

export interface TenderRatesToBeatDto {
  items: RateToBeatDto[];
  likelyBidders: { competitorId: string; name: string; itemsQuoted: number }[];
  /**
   * False until a portal vendor is marked as our own firm. Until then our own past bids are
   * indistinguishable from a competitor's and may be counted among the rates to beat.
   */
  ourFirmKnown: boolean;
}

/** Where we stand in a tender's price opening, by total quote. Read from the stored statement. */
export interface TenderStandingDto {
  fetchedAt: string;
  basisOfEvaluation: string | null;
  bidders: number;
  /** False until one of the bidders is recognised as our own firm. */
  usIdentified: boolean;
  /** 1 = lowest total. Null when our bid is not identified or does not cover every item. */
  ourRank: number | null;
  ourTotal: number | null;
  /** The lowest overall quote: the probable winner, not a confirmed award. */
  lowest: { competitorId: string; name: string; total: number; isSelf: boolean } | null;
}

/** A tender's price opening as one table. Rates are basic price per unit. */
export interface TenderStatementDto {
  fetchedAt: string;
  rfxNumber: string;
  basisOfEvaluation: string | null;
  /** Our own bid first, then the others by total quote, lowest first; partial bids last. */
  bidders: {
    competitorId: string;
    name: string;
    isSelf: boolean;
    total: number | null;
    /** By total, among bids covering every item; null for a partial bid. */
    rank: number | null;
    lowestOverall: boolean;
    deliveryText: string | null;
  }[];
  /** In the statement's own serial order, which is the tender's item order. */
  items: {
    slNo: string;
    itemCode: string;
    description: string;
    unit: string | null;
    quantity: number | null;
    /** competitorId -> basic rate; a bidder who did not quote the item has no entry. */
    rates: Record<string, number>;
  }[];
}

export interface FetchStatementResultDto {
  tenderId: string;
  /** The tender's status after the fetch: a Submitted tender moves to Price opened. */
  status: TenderStatus;
  bidders: number;
  items: number;
  lowestBidder: string | null;
  usFound: boolean;
}
