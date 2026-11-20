import { describe, expect, it } from "vitest";

import { normalizeTechnicalDeviation } from "../technical-deviation.js";

describe("normalizeTechnicalDeviation", () => {
  it.each([
    "",
    "  ",
    "No",
    "no.",
    "NA",
    "N/A",
    "n.a.",
    "Nil",
    "NILL",
    "None",
    "-",
    "--",
    "Not Applicable",
    "ND",
    "No deviation",
    "No Deviations.",
    "no deviation from specification",
  ])("%j means no deviation", (text) => {
    expect(normalizeTechnicalDeviation(text)).toBeNull();
  });

  it("treats null/undefined as no deviation", () => {
    expect(normalizeTechnicalDeviation(null)).toBeNull();
    expect(normalizeTechnicalDeviation(undefined)).toBeNull();
  });

  it("keeps a real deviation that merely starts with No", () => {
    expect(normalizeTechnicalDeviation("  No ISI mark on supplied make ")).toBe("No ISI mark on supplied make");
  });

  it("keeps a real deviation as written, trimmed", () => {
    expect(normalizeTechnicalDeviation("Make KEI instead of Polycab")).toBe("Make KEI instead of Polycab");
  });
});
