import { describe, expect, it } from "vitest";

import { lowestOverallIndex } from "../competitors.repository.js";

const bid = (total: number | null, items: number) => ({ total, items: Array.from({ length: items }) as never[] });

describe("lowestOverallIndex", () => {
  it("picks the smallest total", () => {
    expect(lowestOverallIndex([bid(891000, 1), bid(528000, 1), bid(610500, 1)], 1)).toBe(1);
  });

  it("ignores a bidder who did not quote every item, however small their total", () => {
    expect(lowestOverallIndex([bid(900, 2), bid(100, 1), bid(800, 2)], 2)).toBe(2);
  });

  it("has no lowest bidder when nobody quoted every item the statement lists", () => {
    // Three items; A quoted items 1-2, B quoted items 2-3: neither total covers the whole tender.
    expect(lowestOverallIndex([bid(900, 2), bid(100, 2)], 3)).toBeNull();
  });

  it("ignores a bidder with no total or no items", () => {
    expect(lowestOverallIndex([bid(null, 1), bid(0, 0), bid(500, 1)], 1)).toBe(2);
  });

  it("returns null when nobody qualifies", () => {
    expect(lowestOverallIndex([], 0)).toBeNull();
    expect(lowestOverallIndex([bid(null, 1)], 1)).toBeNull();
  });
});
