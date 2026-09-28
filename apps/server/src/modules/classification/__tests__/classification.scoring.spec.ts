import { describe, expect, it } from "vitest";

import { classifyAgainst, SOURCE_WEIGHTS, type IndexEntry } from "../classification.scoring.js";

function unit(values: number[]): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return Float32Array.from(values.map((v) => v / norm));
}

const index: IndexEntry[] = [
  { heading: "7320", vector: unit([1, 0, 0]), source: "lexicon" }, // "disc spring"
  { heading: "7320", vector: unit([0.9, 0.1, 0]), source: "tariff" },
  { heading: "7307", vector: unit([0, 1, 0]), source: "tariff" },
  { heading: "3919", vector: unit([0, 0, 1]), source: "tariff" },
];

describe("classifyAgainst", () => {
  it("returns the heading of the single closest text, with its chapter", () => {
    const result = classifyAgainst(unit([1, 0.05, 0]), index, { minConfidence: 0 });

    expect(result.headingCode).toBe("7320");
    expect(result.chapterCode).toBe("73");
    expect(result.abstained).toBe(false);
  });

  it("lets one curated term win without being averaged away by its heading's tariff rows", () => {
    // This is the whole reason for nearest-text rather than a class centroid. Heading 7320 has
    // eleven tariff rows and a couple of curated terms, so averaging leaves "disc spring"
    // contributing about a tenth of the direction — and a disc-spring washer lands on 7318, whose
    // own tariff text reads "washers (including spring washers)". Measured on real items, nearest
    // text scored 68.4% against 50.0% for centroids.
    const manyProse: IndexEntry[] = Array.from({ length: 20 }, () => ({
      heading: "7318",
      vector: unit([0.6, 0.8, 0]),
    }));
    const curated: IndexEntry = { heading: "7320", vector: unit([1, 0, 0]) };

    const result = classifyAgainst(unit([1, 0, 0]), [...manyProse, curated], { minConfidence: 0 });
    expect(result.headingCode).toBe("7320");
  });

  it("measures the margin against the best text of a DIFFERENT heading", () => {
    // Two texts of the same heading sitting next to each other is agreement, not ambiguity. Taking
    // the raw second-best would read that as a coin toss and abstain on the clearest cases.
    const result = classifyAgainst(unit([1, 0, 0]), index, { minConfidence: 0 });

    expect(result.headingCode).toBe("7320");
    expect(result.margin).toBeGreaterThan(0.5);
  });

  it("abstains rather than guessing when two headings are equally close", () => {
    // Exactly between 7307 and 3919, so their best texts tie and the margin is zero. The measured
    // median gap on real items is 0.0225 and one known case came down to 0.001 — answers from gaps
    // that size are coin tosses, and an uncertain value never writes itself into a real field.
    const result = classifyAgainst(unit([0, 1, 1]), index, { minConfidence: 0.5 });

    expect(result.margin).toBeCloseTo(0, 5);
    expect(result.abstained).toBe(true);
    expect(result.headingCode).toBeNull();
  });

  it("reports runner-up headings, each listed once", () => {
    const result = classifyAgainst(unit([0.8, 0.6, 0]), index, { minConfidence: 0 });

    const headings = result.alternatives.map((a) => a.headingCode);
    expect(new Set(headings).size).toBe(headings.length);
    expect(headings).not.toContain(result.headingCode);
  });

  it("confidence rises with both similarity and separation from the next heading", () => {
    const clear = classifyAgainst(unit([1, 0, 0]), index, { minConfidence: 0 });
    const marginal = classifyAgainst(unit([1, 0.98, 0]), index, { minConfidence: 0 });

    expect(clear.confidence).toBeGreaterThan(marginal.confidence);
    expect(clear.confidence).toBeLessThanOrEqual(1);
    expect(marginal.confidence).toBeGreaterThanOrEqual(0);
  });

  it("abstains when the index is empty", () => {
    // A fresh deployment, or a rebuild that has not finished writing the index yet.
    const result = classifyAgainst(unit([1, 0, 0]), [], { minConfidence: 0 });

    expect(result.abstained).toBe(true);
    expect(result.headingCode).toBeNull();
  });

  it("answers when only one heading exists, with no other heading to compare against", () => {
    const only: IndexEntry[] = [{ heading: "7320", vector: unit([1, 0, 0]), source: "lexicon" }];
    const result = classifyAgainst(unit([1, 0, 0]), only, { minConfidence: 0 });

    expect(result.headingCode).toBe("7320");
    expect(result.alternatives).toEqual([]);
  });

  it("lets a curated term beat tariff prose that merely looks similar", () => {
    // The real failure this fixes: a mild steel pipe socket matched "STOCKINGS, SOCKS, SOCKETTES
    // AND THE LIKE, OF COTTON" (6217) at 0.636 against the curated term "socket" (7307) at 0.566 —
    // surface form winning over meaning. Down-weighting tariff text flips it back.
    const misleading: IndexEntry[] = [
      { heading: "6217", vector: unit([1, 0, 0]), source: "tariff" },
      { heading: "7307", vector: unit([0.94, 0.34, 0]), source: "lexicon" },
    ];

    const result = classifyAgainst(unit([1, 0, 0]), misleading, { minConfidence: 0 });
    expect(result.headingCode).toBe("7307");
  });

  it("weights tariff below curated, but only mildly", () => {
    // Measured on 933 held-out headings: 0.85 gains 3.8 points where curated terms exist and costs
    // 0.4 where they do not, while 0.6 collapses the non-curated headings by 19 points. The eval
    // set of real items cannot see that harm — it covers 6 headings, all curated.
    expect(SOURCE_WEIGHTS.lexicon).toBe(1);
    expect(SOURCE_WEIGHTS.tariff).toBe(0.85);
  });

  it("treats an unknown source as full weight rather than silently discarding it", () => {
    const future: IndexEntry[] = [
      { heading: "7320", vector: unit([1, 0, 0]), source: "something-new" },
    ];
    const result = classifyAgainst(unit([1, 0, 0]), future, { minConfidence: 0 });

    expect(result.headingCode).toBe("7320");
    expect(result.similarity).toBeCloseTo(1, 5);
  });
});
