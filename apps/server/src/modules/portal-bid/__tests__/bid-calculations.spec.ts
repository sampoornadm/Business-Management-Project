import { describe, expect, it } from "vitest";

import { consignmentWeight, joinHsnCodes, splitGst } from "../bid-calculations.js";

describe("joinHsnCodes", () => {
  it("writes a single distinct code alone", () => {
    expect(joinHsnCodes([{ hsnCode: "4016" }, { hsnCode: "4016" }])).toBe("4016");
  });

  it("joins distinct codes in first-occurrence order", () => {
    expect(joinHsnCodes([{ hsnCode: "4016" }, { hsnCode: "7307" }, { hsnCode: "4016" }])).toBe("4016, 7307");
  });

  it("returns null when no item has a code", () => {
    expect(joinHsnCodes([{ hsnCode: null }, { hsnCode: "" }])).toBeNull();
    expect(joinHsnCodes([])).toBeNull();
  });

  it("skips items without a code but keeps the rest", () => {
    expect(joinHsnCodes([{ hsnCode: null }, { hsnCode: " 7307 " }])).toBe("7307");
  });
});

describe("consignmentWeight", () => {
  it("sums quantity x unit weight and writes it in Kg", () => {
    expect(consignmentWeight([{ quantity: 800, unitWeightKg: 0.0625 }])).toEqual({ text: "50 Kg", missing: 0 });
  });

  it("rounds the total up to the next 10 Kg", () => {
    expect(
      consignmentWeight([
        { quantity: 3, unitWeightKg: 1.25 },
        { quantity: 1, unitWeightKg: 0.5 },
      ]),
    ).toEqual({ text: "10 Kg", missing: 0 });
    expect(consignmentWeight([{ quantity: 205.78, unitWeightKg: 1 }]).text).toBe("210 Kg");
  });

  it("keeps an exact multiple of 10 as it is, despite float noise", () => {
    expect(consignmentWeight([{ quantity: 100, unitWeightKg: 1 }]).text).toBe("100 Kg");
    expect(consignmentWeight([{ quantity: 3, unitWeightKg: 3.3333333333333335 }]).text).toBe("10 Kg");
  });

  it("rounds a tiny positive total up to 10 Kg", () => {
    expect(consignmentWeight([{ quantity: 1, unitWeightKg: 0.001 }]).text).toBe("10 Kg");
  });

  it("reports no text when any item has no unit weight", () => {
    expect(
      consignmentWeight([
        { quantity: 10, unitWeightKg: 2 },
        { quantity: 5, unitWeightKg: null },
      ]),
    ).toEqual({ text: null, missing: 1 });
  });

  it("counts an item with no quantity as missing", () => {
    expect(consignmentWeight([{ quantity: null, unitWeightKg: 2 }])).toEqual({ text: null, missing: 1 });
  });

  it("returns no text for an empty BOQ", () => {
    expect(consignmentWeight([])).toEqual({ text: null, missing: 0 });
  });
});

describe("splitGst", () => {
  const SUPPLIER = "19ADIPC4887G1Z9";

  it("splits 18% into CGST + SGST when both GSTINs are in the same state", () => {
    expect(splitGst(18, SUPPLIER, "19AAACS7062F6Z6")).toEqual({ cgstPct: 9, sgstPct: 9, igstPct: 0 });
  });

  it("charges IGST when the states differ", () => {
    expect(splitGst(18, SUPPLIER, "27AAACS7062F6Z6")).toEqual({ cgstPct: 0, sgstPct: 0, igstPct: 18 });
  });

  it("halves a slab that does not split to a whole number", () => {
    expect(splitGst(5, SUPPLIER, "19AAACS7062F6Z6")).toEqual({ cgstPct: 2.5, sgstPct: 2.5, igstPct: 0 });
  });

  it("returns zeros for a 0% rate", () => {
    expect(splitGst(0, SUPPLIER, "27AAACS7062F6Z6")).toEqual({ cgstPct: 0, sgstPct: 0, igstPct: 0 });
  });

  it("throws when a GSTIN has no state code", () => {
    expect(() => splitGst(18, "", "19AAACS7062F6Z6")).toThrow("GSTIN");
  });
});
