import type { AssistantQueryState } from "@bmp/types";
import { describe, expect, it } from "vitest";

import { mergeState, removeFilter } from "../assistant.merge.js";
import { parseMessage } from "../assistant.parser.js";

const NOW = new Date("2026-09-22T10:00:00Z");
const TZ = "Asia/Kolkata";

const turn = (prior: AssistantQueryState | null, message: string, itemTerms: string[] = [], partyText: string | null = null) =>
  mergeState({ prior, parsed: parseMessage(message, NOW, TZ), itemTerms, partyText });

describe("mergeState — the washer conversation", () => {
  const first = turn(null, "show me which tenders I quoted last month for washers", ["washer"]);

  it("builds the initial query", () => {
    expect(first).toMatchObject({
      entity: "tender",
      itemTerms: ["washer"],
      statuses: [],
      dateField: "quoted",
      dateRange: { label: "last month (August 2026)" },
      partyText: null,
    });
  });

  it("'the ones which I won' keeps item + date and adds the WON status", () => {
    const second = turn(first, "show me the ones which I won");
    expect(second).toEqual({ ...first, statuses: ["WON"] });
  });

  it("'the lost ones' replaces a previous status", () => {
    const won = turn(first, "the ones which I won");
    expect(turn(won, "what about the lost ones?").statuses).toEqual(["LOST"]);
  });

  it("'also the lost ones' adds to it", () => {
    const won = turn(first, "the ones which I won");
    expect(turn(won, "also the lost ones").statuses).toEqual(["WON", "LOST"]);
  });

  it("'remove the won filter' clears it, keeping the rest", () => {
    const won = turn(first, "the ones which I won");
    expect(turn(won, "remove the won filter")).toEqual(first);
  });

  it("a new time phrase replaces only the date", () => {
    const next = turn(first, "and in the last 3 months");
    expect(next.dateRange?.label).toBe("last 3 months");
    expect(next.itemTerms).toEqual(["washer"]);
    expect(next.dateField).toBe("quoted");
  });

  it("new items replace, 'also' adds", () => {
    expect(turn(first, "what about gaskets", ["gasket"]).itemTerms).toEqual(["gasket"]);
    expect(turn(first, "also gaskets", ["gasket"]).itemTerms).toEqual(["washer", "gasket"]);
    expect(turn(first, "and bolts", ["bolt"]).itemTerms).toEqual(["washer", "bolt"]);
  });

  it("dedupes case-insensitively when adding", () => {
    expect(turn(first, "also washers", ["Washer"]).itemTerms).toEqual(["washer"]);
  });

  it("a fresh message naming a document kind starts over", () => {
    const won = turn(first, "the ones which I won");
    const fresh = turn(won, "any RFQs for gaskets this year", ["gasket"]);
    expect(fresh).toMatchObject({ entity: "rfq", itemTerms: ["gasket"], statuses: [], partyText: null, dateField: "created" });
    expect(fresh.dateRange?.label).toBe("this year (2026)");
  });

  it("naming a kind inside a follow-up keeps items/date but drops the tender status", () => {
    const won = turn(first, "the ones which I won");
    const rfqs = turn(won, "show me the RFQs for those");
    expect(rfqs).toMatchObject({ entity: "rfq", itemTerms: ["washer"], statuses: [], dateField: "created" });
    expect(rfqs.dateRange?.label).toBe("last month (August 2026)");
  });

  it("a list of kinds resets the query to all kinds", () => {
    const all = turn(first, "POs, RFQs and bills for gaskets", ["gasket"]);
    expect(all).toMatchObject({ entity: null, itemTerms: ["gasket"] });
  });

  it("carries a party name and can clear it", () => {
    const meridian = turn(first, "only Meridian ones", [], "Meridian");
    expect(meridian.partyText).toBe("Meridian");
    expect(turn(meridian, "the lost ones").partyText).toBe("Meridian");
    expect(turn(meridian, "any client").partyText).toBeNull();
  });

  it("does not let a status that its kind cannot have survive", () => {
    const rfqFresh = turn(null, "RFQs I won for washers", ["washer"]);
    expect(rfqFresh.statuses).toEqual([]);
  });
});

describe("removeFilter (chip dismissal)", () => {
  const state: AssistantQueryState = {
    entity: "tender",
    itemTerms: ["washer"],
    statuses: ["WON"],
    dateField: "quoted",
    dateRange: { from: "2026-07-31T18:30:00.000Z", to: "2026-08-31T18:30:00.000Z", label: "last month" },
    partyText: "Meridian",
  };

  it("clears exactly one filter", () => {
    expect(removeFilter(state, "statuses").statuses).toEqual([]);
    expect(removeFilter(state, "dateRange").dateRange).toBeNull();
    expect(removeFilter(state, "itemTerms").itemTerms).toEqual([]);
    expect(removeFilter(state, "partyText").partyText).toBeNull();
    expect(removeFilter(state, "entity").entity).toBeNull();
  });

  it("dropping the kind also drops statuses only that kind can have", () => {
    expect(removeFilter({ ...state, statuses: ["WON"] }, "entity").statuses).toEqual(["WON"]); // valid for some kind (tender)
    expect(removeFilter({ ...state, entity: "rfq", statuses: ["SENT"] }, "entity").statuses).toEqual(["SENT"]);
  });
});
