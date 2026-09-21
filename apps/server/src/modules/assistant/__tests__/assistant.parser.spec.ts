import { describe, expect, it } from "vitest";

import { parseMessage } from "../assistant.parser.js";

const NOW = new Date("2026-09-22T10:00:00Z");
const parse = (m: string) => parseMessage(m, NOW, "Asia/Kolkata");

describe("parseMessage", () => {
  it("understands the headline query: tenders quoted last month for washers", () => {
    const p = parse("show me which tenders I quoted last month for washers");
    expect(p.entity).toBe("tender");
    expect(p.entityExplicit).toBe(true);
    expect(p.dateField).toBe("quoted");
    expect(p.date?.range.label).toBe("last month (August 2026)");
    expect(p.statuses).toEqual([]);
    expect(p.cues.refine).toBe(false);
    expect(p.hasSignal).toBe(true);
    // recognised phrases are blanked, the item clause survives for the heuristic fallback
    expect(p.residual).toContain("washers");
    expect(p.residual).not.toMatch(/tender|quoted|last month/i);
  });

  it("reads 'the ones which I won' as a refinement with a WON status and no explicit entity", () => {
    const p = parse("show me the ones which I won");
    expect(p.statuses).toEqual(["WON"]);
    expect(p.cues.refine).toBe(true);
    expect(p.entityExplicit).toBe(false);
    expect(p.entity).toBe("tender"); // inferred from the status, only tenders can be won
    expect(p.date).toBeNull();
  });

  it("maps status words to their document kind", () => {
    expect(parse("lost tenders").statuses).toEqual(["LOST"]);
    expect(parse("RFQs sent this month")).toMatchObject({ entity: "rfq", statuses: ["SENT"] });
    expect(parse("purchase orders partially received")).toMatchObject({ entity: "purchase_order", statuses: ["PARTIALLY_RECEIVED"] });
    expect(parse("POs received last week")).toMatchObject({ entity: "purchase_order", statuses: ["RECEIVED"] });
    expect(parse("cancelled drafts").statuses).toEqual(["CANCELLED", "DRAFT"]);
  });

  it("recognises the document kinds", () => {
    expect(parse("bills for cable").entity).toBe("bill");
    expect(parse("any RFQs for gaskets this year").entity).toBe("rfq");
    expect(parse("request for quotation for bolts").entity).toBe("rfq");
    expect(parse("the tender for washers").entity).toBe("tender");
  });

  it("treats a list of kinds as 'all of them'", () => {
    const p = parse("purchase orders and RFQs and bills with washers");
    expect(p.allKinds).toBe(true);
    expect(p.entity).toBeNull();
    expect(p.entityExplicit).toBe(true);
    expect(parse("tenders, RFQs & bills for cable").allKinds).toBe(true);
    // a kind merely mentioned in passing is not a list
    expect(parse("bills for tenders quoted last month")).toMatchObject({ allKinds: false, entity: "bill" });
    expect(parse("tenders for washers").allKinds).toBe(false);
  });

  it("picks the date field from the wording", () => {
    expect(parse("tenders submitted last month").dateField).toBe("quoted");
    expect(parse("tenders due next month").dateField).toBe("deadline");
    expect(parse("RFQs created in August").dateField).toBe("created");
    expect(parse("tenders for washers").dateField).toBeNull();
  });

  it("does not treat 'quotes' as our quotation, but does treat 'we quote'", () => {
    expect(parse("vendor quotes for washers").dateField).toBeNull();
    expect(parse("which tenders did we quote in September").dateField).toBe("quoted");
    expect(parse("the ones I quote").dateField).toBe("quoted");
  });

  it("lets deadlines look forward", () => {
    expect(parse("tenders due in March").date?.range.label).toBe("March 2027");
    expect(parse("tenders created in March").date?.range.label).toBe("March 2026");
  });

  it("turns 'remove the won filter' into a clear, not a WON filter", () => {
    const p = parse("remove the won filter");
    expect(p.cues.clearStatuses).toBe(true);
    expect(p.statuses).toEqual([]);
  });

  it("recognises the other clear cues", () => {
    expect(parse("any status").cues.clearStatuses).toBe(true);
    expect(parse("for all time").cues.clearDate).toBe(true);
    expect(parse("drop the date filter").cues.clearDate).toBe(true);
    expect(parse("remove the item filter").cues.clearItems).toBe(true);
    expect(parse("any client").cues.clearParty).toBe(true);
  });

  it("detects follow-up and additive wording", () => {
    expect(parse("and for cables?")).toMatchObject({ cues: expect.objectContaining({ refine: true, add: true }) });
    expect(parse("also gaskets").cues.add).toBe(true);
    expect(parse("only the lost ones").cues.refine).toBe(true);
    expect(parse("what about last year").cues.refine).toBe(true);
    expect(parse("tenders for washers and bolts").cues.refine).toBe(false);
  });

  it("flags document numbers but not material grades", () => {
    expect(parse("find the bill for tender TND-2026-001").documentNumber).toBe(true);
    expect(parse("TND-2041").documentNumber).toBe(true);
    expect(parse("tenders with SS-304 washers last month").documentNumber).toBe(false);
  });

  it("reports no signal for plain free text", () => {
    expect(parse("washers").hasSignal).toBe(false);
    expect(parse("Meridian Power").hasSignal).toBe(false);
  });
});
