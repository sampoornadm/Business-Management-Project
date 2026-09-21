import {
  ASSISTANT_DATE_FIELDS,
  ASSISTANT_ENTITIES,
  type AssistantEntity,
  type AssistantQueryState,
} from "@bmp/types";
import { z } from "zod";

/** Statuses a document kind can actually have — the only values a filter may carry for it. */
export const ENTITY_STATUSES: Record<AssistantEntity, readonly string[]> = {
  tender: ["DRAFT", "SUBMITTED", "WON", "LOST", "CANCELLED"],
  rfq: ["DRAFT", "SENT", "CLOSED", "CANCELLED"],
  purchase_order: ["DRAFT", "ISSUED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  bill: [],
};

export const ENTITY_LABELS: Record<AssistantEntity, { singular: string; plural: string; party: string }> = {
  tender: { singular: "tender", plural: "tenders", party: "Client" },
  rfq: { singular: "RFQ", plural: "RFQs", party: "Vendor" },
  purchase_order: { singular: "purchase order", plural: "purchase orders", party: "Vendor" },
  bill: { singular: "bill", plural: "bills", party: "Client" },
};

/** Permission needed to see each kind of result (mirrors the routes' own requirePermission keys). */
export const ENTITY_PERMISSION: Record<AssistantEntity, string> = {
  tender: "tenders:read",
  rfq: "rfq:read",
  purchase_order: "purchase_orders:read",
  bill: "bills:read",
};

export const EMPTY_STATE: AssistantQueryState = {
  entity: null,
  itemTerms: [],
  statuses: [],
  dateField: "created",
  dateRange: null,
  partyText: null,
};

const isoDate = z.string().datetime();

/**
 * Client-echoed state is untrusted input: strict shape, bounded sizes. It can only ever narrow a
 * query that is still scoped to the caller's business and permissions server-side.
 */
export const assistantStateSchema = z
  .object({
    entity: z.enum(ASSISTANT_ENTITIES).nullable(),
    itemTerms: z.array(z.string().trim().min(1).max(60)).max(8),
    statuses: z.array(z.string().max(30)).max(6),
    dateField: z.enum(ASSISTANT_DATE_FIELDS),
    dateRange: z.object({ from: isoDate, to: isoDate, label: z.string().max(80) }).nullable(),
    partyText: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

/** Statuses valid for `entity` (or for at least one kind when the entity is unspecified). */
export function validStatuses(entity: AssistantEntity | null, statuses: readonly string[]): string[] {
  const allowed = entity
    ? new Set(ENTITY_STATUSES[entity])
    : new Set(ASSISTANT_ENTITIES.flatMap((e) => ENTITY_STATUSES[e]));
  return [...new Set(statuses.filter((s) => allowed.has(s)))];
}

/** Re-establishes invariants after a state came from the client or a merge. */
export function normalizeState(state: AssistantQueryState): AssistantQueryState {
  const entity = state.entity;
  return {
    ...state,
    statuses: validStatuses(entity, state.statuses),
    // "quoted" is a tender concept; for other document kinds it degrades to creation date.
    dateField: state.dateField === "quoted" && entity !== null && entity !== "tender" ? "created" : state.dateField,
  };
}
