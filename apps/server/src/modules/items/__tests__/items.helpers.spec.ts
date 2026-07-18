import { describe, expect, it } from "vitest";

import { deriveCanonicalName, parseClassification } from "../items.helpers.js";
import { aggregateQuotes, sortItemEntries } from "../items.mapper.js";
import type { ItemQuoteRow } from "../items.repository.js";

describe("deriveCanonicalName", () => {
  it("prefers the AI normalized name over the raw description", () => {
    expect(deriveCanonicalName("XLPE Cable 4C x16", "xlpe   cable 4 core 16 sqmm")).toBe("XLPE Cable 4C x16");
  });

  it("falls back to a whitespace-collapsed description when there is no normalized name", () => {
    expect(deriveCanonicalName(null, "  RMC   M25\tgrade ")).toBe("RMC M25 grade");
    expect(deriveCanonicalName("   ", "Cement OPC 53")).toBe("Cement OPC 53");
  });

  it("caps length so the unique index stays within Postgres limits", () => {
    expect(deriveCanonicalName(null, "x".repeat(500))).toHaveLength(300);
  });
});

describe("parseClassification", () => {
  const leafIds = new Set(["a", "b"]);

  it("keeps an id that is in the allowed set", () => {
    expect(parseClassification({ categoryId: "a", confidence: 0.8 }, leafIds)).toEqual({
      categoryId: "a",
      confidence: 0.8,
    });
  });

  it("rejects an invented id — the taxonomy is closed", () => {
    expect(parseClassification({ categoryId: "z", confidence: 0.9 }, leafIds)).toEqual({
      categoryId: null,
      confidence: 0,
    });
  });

  it("clamps confidence and tolerates junk", () => {
    expect(parseClassification({ categoryId: "b", confidence: 5 }, leafIds).confidence).toBe(1);
    expect(parseClassification("not an object", leafIds)).toEqual({ categoryId: null, confidence: 0 });
  });
});

describe("aggregateQuotes", () => {
  it("computes count, distinct vendors, min/max/avg and the latest date per item", () => {
    const rows: ItemQuoteRow[] = [
      { itemId: "i1", rate: 100, vendorId: "v1", quotedAt: new Date("2026-01-01") },
      { itemId: "i1", rate: 200, vendorId: "v2", quotedAt: new Date("2026-03-01") },
      { itemId: "i1", rate: 150, vendorId: "v1", quotedAt: new Date("2026-02-01") },
    ];
    const agg = aggregateQuotes(rows).get("i1")!;
    expect(agg).toMatchObject({ quoteCount: 3, vendorCount: 2, minRate: 100, maxRate: 200 });
    expect(agg.avgRate).toBeCloseTo(150);
    expect(agg.lastQuotedAt.toISOString()).toBe(new Date("2026-03-01").toISOString());
  });
});

describe("sortItemEntries nulls-last", () => {
  const base = {
    id: "",
    canonicalName: "",
    unit: null,
    categoryId: null,
    categoryPath: null,
    confirmed: false,
    aiConfidence: null,
    quoteCount: 0,
    vendorCount: 0,
    maxRate: null,
    avgRate: null,
    lastQuotedAt: null,
  };
  const priced = { ...base, id: "priced", minRate: 100 };
  const unpriced = { ...base, id: "unpriced", minRate: null };

  it("keeps null aggregates last in both directions", () => {
    expect(sortItemEntries([unpriced, priced], "minRate", "asc")[0]!.id).toBe("priced");
    expect(sortItemEntries([priced, unpriced], "minRate", "desc")[0]!.id).toBe("priced");
  });
});
