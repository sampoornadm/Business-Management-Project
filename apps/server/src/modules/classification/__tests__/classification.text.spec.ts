import { describe, expect, it } from "vitest";

import { normaliseText } from "../classification.text.js";

// Shared fixture: the same table lives in ml/train/tests/test_text.py. Change a row in both places.
const CASES: [string, string][] = [
  ["PURE-BRED BREEDING ANIMALS.", "pure bred breeding animals"],
  ["PU : TUBE", "pu tube"],
  ["  Push-in  fitting,  10MM ", "push in fitting 10mm"],
  ["T/CONNECTOR_(BRASS)", "t connector brass"],
  ["", ""],
];

describe("normaliseText", () => {
  it.each(CASES)("normalises %j", (raw, expected) => {
    expect(normaliseText(raw)).toBe(expected);
  });

  it("makes tariff and purchase-order wording meet", () => {
    expect(normaliseText("LIVE HORSES, ASSES.")).toBe(normaliseText("live horses  asses"));
  });
});
