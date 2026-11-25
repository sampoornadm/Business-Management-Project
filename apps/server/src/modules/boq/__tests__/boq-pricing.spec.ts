import { describe, expect, it } from "vitest";

import { distributeCharges, markupFromRate, rateFromMarkup } from "../boq-pricing.js";

describe("boq pricing", () => {
  it("rateFromMarkup applies the markup and rounds to 2 dp", () => {
    expect(rateFromMarkup(100, 15)).toBe(115);
    expect(rateFromMarkup(33.33, 15)).toBe(38.33);
  });

  it("markupFromRate derives the markup from a typed rate", () => {
    expect(markupFromRate(100, 120, 15)).toBe(20);
  });

  it("markupFromRate keeps the fallback when the base rate is 0", () => {
    expect(markupFromRate(0, 50, 15)).toBe(15);
    expect(markupFromRate(0, 50, null)).toBeNull();
  });

  it("distributeCharges spreads charges by line value and re-runs idempotently", () => {
    const lines = [
      { id: "a", quantity: 10, rate: 100, chargeLoad: null }, // 1000
      { id: "b", quantity: 2, rate: 500, chargeLoad: null }, // 1000
      { id: "c", quantity: null, rate: 50, chargeLoad: null }, // no quantity: no share
    ];
    const updates = distributeCharges(lines, 200); // +10%
    expect(updates).toEqual([
      { id: "a", rate: 110, amount: 1100, chargeLoad: 10 },
      { id: "b", rate: 550, amount: 1100, chargeLoad: 50 },
    ]);

    const applied = lines.map((line) => ({ ...line, ...updates.find((u) => u.id === line.id) }));
    expect(distributeCharges(applied, 200)).toEqual([]);
    // Charges removed: rates fall back to their pre-charge value.
    expect(distributeCharges(applied, 0)).toEqual([
      { id: "a", rate: 100, amount: 1000, chargeLoad: null },
      { id: "b", rate: 500, amount: 1000, chargeLoad: null },
    ]);
  });
});
