import type { AssistantQueryState } from "@bmp/types";

import type { ParsedMessage } from "./assistant.parser.js";
import { EMPTY_STATE, normalizeState } from "./assistant.query.js";

export interface MergeInput {
  prior: AssistantQueryState | null;
  parsed: ParsedMessage;
  itemTerms: string[];
  partyText: string | null;
}

/** Order-preserving union; the first spelling of a case-insensitive duplicate wins. */
function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Folds one message into the running query. The rules are what make follow-ups feel right:
 *  - naming a document kind ("any RFQs for gaskets") starts a fresh query, unless the message is
 *    clearly a continuation ("the RFQs for those");
 *  - otherwise the message refines the prior query: what it mentions replaces, what it does not
 *    mention is kept, "also"/"and" adds instead of replacing, and "remove the X filter" clears;
 *  - switching document kind keeps item/date/… but drops statuses (a tender's WON means nothing
 *    for an RFQ).
 */
export function mergeState({ prior, parsed, itemTerms, partyText }: MergeInput): AssistantQueryState {
  const fresh = prior === null || (parsed.entityExplicit && !parsed.cues.refine);
  const base = fresh ? EMPTY_STATE : prior;
  const { cues } = parsed;

  const entity = parsed.allKinds ? null : (parsed.entity ?? base.entity);
  const entityChanged = !fresh && (parsed.allKinds || parsed.entity !== null) && entity !== base.entity;

  const statuses = parsed.statuses.length
    ? cues.add
      ? union(base.statuses, parsed.statuses)
      : parsed.statuses
    : cues.clearStatuses || entityChanged
      ? []
      : base.statuses;

  const terms = itemTerms.length
    ? cues.add
      ? union(base.itemTerms, itemTerms)
      : itemTerms
    : cues.clearItems
      ? []
      : base.itemTerms;

  return normalizeState({
    entity,
    itemTerms: terms,
    statuses,
    dateField: parsed.dateField ?? (cues.clearDate ? "created" : base.dateField),
    dateRange: parsed.date ? parsed.date.range : cues.clearDate ? null : base.dateRange,
    partyText: partyText ?? (cues.clearParty || entityChanged ? null : base.partyText),
  });
}

export type FilterKey = "entity" | "itemTerms" | "statuses" | "dateRange" | "partyText";

/** Dismissing a filter chip: same result as saying "remove the X filter", without any parsing. */
export function removeFilter(state: AssistantQueryState, key: FilterKey): AssistantQueryState {
  switch (key) {
    case "entity":
      return normalizeState({ ...state, entity: null });
    case "itemTerms":
      return { ...state, itemTerms: [] };
    case "statuses":
      return { ...state, statuses: [] };
    case "dateRange":
      return { ...state, dateRange: null, dateField: "created" };
    case "partyText":
      return { ...state, partyText: null };
  }
}
