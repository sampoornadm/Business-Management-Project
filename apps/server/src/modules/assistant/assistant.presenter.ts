import type {
  AssistantEntity,
  AssistantFilterChipDto,
  AssistantQueryState,
  SearchEntityType,
  SearchResultItemDto,
} from "@bmp/types";

import { formatLocalDate } from "./assistant.dates.js";
import { ENTITY_LABELS } from "./assistant.query.js";
import type { AssistantHit, AssistantHitType } from "./assistant.repository.js";

/** Turns hits, filters and counts into what the chat shows. All text here is deterministic. */

const HREF: Record<AssistantHitType, (id: string) => string> = {
  Tender: (id) => `/tenders/${id}`,
  Rfq: (id) => `/rfqs/${id}`,
  PurchaseOrder: (id) => `/purchase-orders/${id}`,
  Bill: (id) => `/bills/${id}`,
};

const TYPE_TO_ENTITY: Record<AssistantHitType, AssistantEntity> = {
  Tender: "tender",
  Rfq: "rfq",
  PurchaseOrder: "purchase_order",
  Bill: "bill",
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = (status: string): string => capitalize(status.toLowerCase().replace(/_/g, " "));
const orList = (items: string[]): string => items.join(" or ");

export function hitToResult(hit: AssistantHit, tz: string): SearchResultItemDto {
  const subtitle = [
    hit.reference,
    hit.status ? humanize(hit.status) : null,
    hit.date ? `${hit.dateLabel} ${formatLocalDate(hit.date, tz)}` : null,
    hit.matchedItem ? `Item: ${hit.matchedItem}` : null,
    hit.party,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    type: hit.type as SearchEntityType,
    id: hit.id,
    title: hit.title,
    subtitle: subtitle || null,
    href: HREF[hit.type](hit.id),
  };
}

const DATE_FIELD_LABEL = { quoted: "Quoted", created: "Created", deadline: "Due" } as const;

/** The active filters as dismissible chips — shows the user exactly how their words were read. */
export function buildChips(state: AssistantQueryState): AssistantFilterChipDto[] {
  const chips: AssistantFilterChipDto[] = [];
  if (state.entity) chips.push({ key: "entity", label: capitalize(ENTITY_LABELS[state.entity].plural) });
  if (state.itemTerms.length > 0) {
    chips.push({ key: "itemTerms", label: `Item: ${orList(state.itemTerms)}` });
  }
  if (state.statuses.length > 0) {
    chips.push({ key: "statuses", label: `Status: ${orList(state.statuses.map(humanize))}` });
  }
  if (state.dateRange) {
    chips.push({ key: "dateRange", label: `${DATE_FIELD_LABEL[state.dateField]}: ${state.dateRange.label}` });
  } else if (state.dateField !== "created") {
    chips.push({ key: "dateRange", label: `${DATE_FIELD_LABEL[state.dateField]}: any time` });
  }
  if (state.partyText) {
    const party = state.entity ? ENTITY_LABELS[state.entity].party : "Client / vendor";
    chips.push({ key: "partyText", label: `${party}: ${state.partyText}` });
  }
  return chips;
}

export interface KindCount {
  type: AssistantHitType;
  total: number;
}

export function buildReply(
  state: AssistantQueryState,
  counts: KindCount[],
  shown: number,
  skipped: string[],
): string {
  const total = counts.reduce((sum, c) => sum + c.total, 0);
  const summary = buildChips(state)
    .filter((c) => c.key !== "entity")
    .map((c) => c.label)
    .join(" · ");
  const withFilters = summary ? ` (${summary})` : "";

  // Asked for one kind and not allowed to see it: say so plainly rather than "nothing found".
  if (state.entity && skipped.length > 0) return `You don't have access to ${skipped[0]}.`;

  let reply: string;
  if (total === 0) {
    const noun = state.entity ? ENTITY_LABELS[state.entity].plural : "documents";
    reply = `No ${noun} found${withFilters}. Try removing a filter.`;
  } else if (state.entity) {
    const { singular, plural } = ENTITY_LABELS[state.entity];
    reply = `Found ${total} ${total === 1 ? singular : plural}${withFilters}.`;
  } else {
    const breakdown = counts
      .filter((c) => c.total > 0)
      .map((c) => {
        const labels = ENTITY_LABELS[TYPE_TO_ENTITY[c.type]];
        return `${c.total} ${c.total === 1 ? labels.singular : labels.plural}`;
      })
      .join(", ");
    reply = `Found ${total} document${total === 1 ? "" : "s"}: ${breakdown}${withFilters}.`;
  }
  if (shown < total) reply += ` Showing the first ${shown}; refine to narrow it down.`;
  if (skipped.length > 0) reply += ` (No access to ${skipped.join(", ")}.)`;
  return reply;
}
