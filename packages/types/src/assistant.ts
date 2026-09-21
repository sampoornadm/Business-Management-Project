import type { SearchResultItemDto } from "./report.js";

/** Document kinds the assistant can query by item / status / date. `null` in a state means "all". */
export const ASSISTANT_ENTITIES = ["tender", "rfq", "purchase_order", "bill"] as const;
export type AssistantEntity = (typeof ASSISTANT_ENTITIES)[number];

/**
 * Which date the range applies to. `quoted` (tenders only) = when a quotation went out: the
 * earliest of the tender moving to SUBMITTED and a QUOTATION document being generated.
 */
export const ASSISTANT_DATE_FIELDS = ["quoted", "created", "deadline"] as const;
export type AssistantDateField = (typeof ASSISTANT_DATE_FIELDS)[number];

/** Half-open range: `from` inclusive, `to` exclusive (ISO instants). */
export interface AssistantDateRangeDto {
  from: string;
  to: string;
  label: string;
}

/**
 * The structured query behind a chat turn. Returned to the client and echoed back on the next
 * turn, so follow-ups ("the ones I won") refine it without any server-side session.
 */
export interface AssistantQueryState {
  entity: AssistantEntity | null;
  /** Any-of (OR); each term is matched case-insensitively against item descriptions. */
  itemTerms: string[];
  statuses: string[];
  dateField: AssistantDateField;
  dateRange: AssistantDateRangeDto | null;
  /** Client (tenders, bills) or vendor (RFQs, POs) name fragment. */
  partyText: string | null;
}

export const ASSISTANT_FILTER_KEYS = ["entity", "itemTerms", "statuses", "dateRange", "partyText"] as const;
export type AssistantFilterKey = (typeof ASSISTANT_FILTER_KEYS)[number];

export interface AssistantFilterChipDto {
  key: AssistantFilterKey;
  label: string;
}

export interface AssistantQueryInput {
  /** Optional only when `state` + `removeFilter` re-run a query after a chip is dismissed. */
  message?: string;
  state?: AssistantQueryState | null;
  removeFilter?: AssistantFilterKey;
}

export interface AssistantQueryResultDto {
  reply: string;
  results: SearchResultItemDto[];
  /** Total matches before the per-turn display cap. */
  total: number;
  filters: AssistantFilterChipDto[];
  /** Null when the turn fell back to plain document search (nothing structured to refine). */
  state: AssistantQueryState | null;
}
