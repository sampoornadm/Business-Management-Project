import { describe, expect, it } from "vitest";

import { suggestRfqTitle } from "./rfq-title";

describe("suggestRfqTitle", () => {
  it("starts at 1 for a tender with no RFQs", () => {
    expect(suggestRfqTitle("T-100", [], 0)).toBe("T-100-RFQ-1");
  });

  it("follows the highest number, not string order", () => {
    const titles = Array.from({ length: 10 }, (_, i) => `T-100-RFQ-${i + 1}`);
    expect(suggestRfqTitle("T-100", titles, 10)).toBe("T-100-RFQ-11");
  });

  it("does not reuse a number after a deletion", () => {
    expect(suggestRfqTitle("T-100", ["T-100-RFQ-2"], 1)).toBe("T-100-RFQ-3");
  });

  it("counts older RFQs with other names", () => {
    expect(suggestRfqTitle("T-100", ["Cement", "Steel"], 2)).toBe("T-100-RFQ-3");
  });

  it("ignores titles that only look similar", () => {
    expect(suggestRfqTitle("T-100", ["T-100-RFQ-9a", "T-1000-RFQ-7"], 2)).toBe("T-100-RFQ-3");
  });
});
