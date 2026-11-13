// Competitor rates read from the client portal's comparative statement (SAIL ISP). All rates
// are the basic price per unit unless a field says otherwise.

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
}

export interface FetchStatementResultDto {
  tenderId: string;
  bidders: number;
  items: number;
  lowestBidder: string | null;
  usFound: boolean;
}
