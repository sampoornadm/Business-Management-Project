import { describe, expect, it } from "vitest";

import { markupFromRate, rateFromMarkup } from "../boq-pricing.js";

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
});
