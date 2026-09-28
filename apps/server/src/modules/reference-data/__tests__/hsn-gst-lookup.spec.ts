import { describe, expect, it } from "vitest";

import {
  deriveDisplayName,
  disambiguateDisplayNames,
  findOrphanHeadings,
  parseActiveFlag,
  parseGstRate,
  parseTradeTerms,
  serializeTradeTerms,
} from "../hsn-gst-lookup.js";

describe("deriveDisplayName", () => {
  it("keeps the leading clause of a real CBIC heading, dropping the parenthetical examples", () => {
    expect(
      deriveDisplayName("TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL"),
    ).toBe("Tube or pipe fittings");
  });

  it("sentence-cases shouted tariff text", () => {
    expect(deriveDisplayName("SPRINGS AND LEAVES FOR SPRINGS, OF IRON OR STEEL")).toBe(
      "Springs and leaves for springs",
    );
  });

  it("keeps extending past a boundary while the label is uselessly short", () => {
    // Real 7323. Cutting at the first comma yields "Table", which identifies nothing.
    expect(
      deriveDisplayName("TABLE, KITCHEN OR OTHER HOUSEHOLD ARTICLES AND PARTS THEREOF; IRON OR STEEL WOOL"),
    ).toBe("Table, kitchen or other household articles and parts thereof");
  });

  it("drops a parenthetical digression before choosing the clause", () => {
    // Real 8544. Cutting at " (" first yields "Insulated", which is meaningless.
    expect(
      deriveDisplayName("INSULATED (INCLUDING ENAMELLED OR ANODISED) WIRE, CABLE AND OTHER CONDUCTORS"),
    ).toBe("Insulated wire");
  });

  it("extends a short enumeration to the first few members", () => {
    // Real 7318. "Screws" alone is too generic to pick from a list of 1,379.
    expect(deriveDisplayName("SCREWS, BOLTS, NUTS, COACH-SCREWS, SCREW HOOKS, RIVETS")).toBe(
      "Screws, bolts, nuts",
    );
  });

  it("truncates a very long description at a word boundary, never mid-word", () => {
    // Chapter 85's real description is 1,210 characters — the longest in the sheet.
    const long =
      "ELECTRICAL MACHINERY AND EQUIPMENT AND PARTS THEREOF SOUND RECORDERS AND REPRODUCERS " +
      "TELEVISION IMAGE AND SOUND RECORDERS AND REPRODUCERS AND PARTS AND ACCESSORIES OF SUCH ARTICLES";
    const name = deriveDisplayName(long);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toBe("Electrical machinery and equipment and parts thereof sound");
    expect(name.endsWith(" ")).toBe(false);
  });

  it("falls back to the full text when the first boundary is at position 0", () => {
    expect(deriveDisplayName(": OTHER")).toBe(": other");
  });

  it("returns empty for empty input", () => {
    expect(deriveDisplayName("   ")).toBe("");
  });

  it("keeps the text when the whole description is one parenthetical", () => {
    // Real chapter 77, which HS reserves for future use. Stripping the parenthetical leaves
    // nothing, and a blank label fails the taxonomy import outright.
    expect(deriveDisplayName("(Reserved for possible future use)")).toBe(
      "Reserved for possible future use",
    );
  });

  it("collapses whitespace from multi-line cells", () => {
    expect(deriveDisplayName("IRON\n  AND   STEEL")).toBe("Iron and steel");
  });
});

describe("parseTradeTerms / serializeTradeTerms", () => {
  it("splits on semicolons and drops blanks", () => {
    expect(parseTradeTerms("disc spring;; Belleville washer ;  cup spring ")).toEqual([
      "disc spring",
      "Belleville washer",
      "cup spring",
    ]);
  });

  it("returns an empty list for an empty cell", () => {
    expect(parseTradeTerms(undefined)).toEqual([]);
    expect(parseTradeTerms("")).toEqual([]);
  });

  it("round-trips", () => {
    const terms = ["disc spring", "Belleville washer"];
    expect(parseTradeTerms(serializeTradeTerms(terms))).toEqual(terms);
  });
});

describe("parseActiveFlag", () => {
  it("defaults to active when the cell is blank", () => {
    expect(parseActiveFlag("")).toBe(true);
    expect(parseActiveFlag(null)).toBe(true);
  });

  it("accepts the spellings a person actually types", () => {
    expect(parseActiveFlag(true)).toBe(true);
    expect(parseActiveFlag("TRUE")).toBe(true);
    expect(parseActiveFlag("yes")).toBe(true);
    expect(parseActiveFlag(1)).toBe(true);
  });

  it("treats anything unrecognised as inactive rather than guessing it on", () => {
    expect(parseActiveFlag("no")).toBe(false);
    expect(parseActiveFlag("maybe")).toBe(false);
    expect(parseActiveFlag(0)).toBe(false);
  });
});

describe("parseGstRate", () => {
  it("accepts a plain number", () => {
    expect(parseGstRate(18)).toBe(18);
  });

  it("accepts a string with a percent sign", () => {
    expect(parseGstRate("18%")).toBe(18);
  });

  it("accepts the sub-1% slabs that exist after Sept 2025", () => {
    expect(parseGstRate(0.25)).toBe(0.25);
    expect(parseGstRate(1.5)).toBe(1.5);
  });

  it("rejects out-of-range and unparseable values rather than coercing them", () => {
    expect(parseGstRate(-1)).toBeNull();
    expect(parseGstRate(101)).toBeNull();
    expect(parseGstRate("eighteen")).toBeNull();
    expect(parseGstRate("")).toBeNull();
  });
});

describe("disambiguateDisplayNames", () => {
  it("leaves unique names alone", () => {
    const result = disambiguateDisplayNames([
      { code: "7307", displayName: "Tube or pipe fittings" },
      { code: "7320", displayName: "Springs and leaves for springs" },
    ]);
    expect(result.get("7307")).toBe("Tube or pipe fittings");
    expect(result.get("7320")).toBe("Springs and leaves for springs");
  });

  it("appends the code to a colliding label so a picker never shows two identical entries", () => {
    // 15 heading descriptions genuinely repeat inside one chapter in the real CBIC data.
    const result = disambiguateDisplayNames([
      { code: "1001", displayName: "Other" },
      { code: "1002", displayName: "Other" },
    ]);
    expect(result.get("1001")).toBe("Other");
    expect(result.get("1002")).toBe("Other (1002)");
  });

  it("is case-insensitive about collisions", () => {
    const result = disambiguateDisplayNames([
      { code: "1001", displayName: "Other" },
      { code: "1002", displayName: "OTHER" },
    ]);
    expect(result.get("1002")).toBe("OTHER (1002)");
  });
});

describe("findOrphanHeadings", () => {
  it("keeps a heading that has 6-digit descendants", () => {
    const orphans = findOrphanHeadings([
      { code: "07", codeLength: 2 },
      { code: "0307", codeLength: 4 },
      { code: "030731", codeLength: 6 },
    ]);
    expect(orphans.has("0307")).toBe(false);
  });

  it("flags a heading with no descendants at all", () => {
    // Real CBIC data carries "3073" — a length-4 row whose text is subheading 030731's ("Mussels"),
    // left behind when a leading zero was lost. Chapter 30 is pharmaceuticals and has no heading 73,
    // so nothing sits under it. 78 such rows exist, and each is a class the classifier could predict.
    const orphans = findOrphanHeadings([
      { code: "30", codeLength: 2 },
      { code: "3073", codeLength: 4 },
      { code: "3001", codeLength: 4 },
      { code: "300110", codeLength: 6 },
    ]);
    expect(orphans.has("3073")).toBe(true);
    expect(orphans.has("3001")).toBe(false);
  });

  it("accepts an 8-digit descendant as proof a heading is real", () => {
    const orphans = findOrphanHeadings([
      { code: "7320", codeLength: 4 },
      { code: "73201011", codeLength: 8 },
    ]);
    expect(orphans.has("7320")).toBe(false);
  });

  it("never flags a chapter, which has headings rather than 6-digit descendants", () => {
    const orphans = findOrphanHeadings([{ code: "77", codeLength: 2 }]);
    expect(orphans.size).toBe(0);
  });

  it("does not let a sibling heading's descendant rescue an orphan", () => {
    // "7320" must not be kept alive by "73210011", which sits under heading 7321.
    const orphans = findOrphanHeadings([
      { code: "7320", codeLength: 4 },
      { code: "7321", codeLength: 4 },
      { code: "73210011", codeLength: 8 },
    ]);
    expect(orphans.has("7320")).toBe(true);
    expect(orphans.has("7321")).toBe(false);
  });
});
