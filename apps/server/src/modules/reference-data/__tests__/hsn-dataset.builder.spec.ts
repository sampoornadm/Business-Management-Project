import { describe, expect, it } from "vitest";

import {
  buildExamples,
  splitExamples,
  summarise,
  type TariffRow,
  type TrainingExample,
} from "../hsn-dataset.builder.js";
import type { LookupRow } from "../hsn-gst-lookup.js";

function heading(code: string, overrides: Partial<LookupRow> = {}): LookupRow {
  return {
    code,
    level: "heading",
    parentCode: code.slice(0, 2),
    officialDescription: `OFFICIAL TEXT FOR ${code}`,
    displayName: `Heading ${code}`,
    gstRate: 18,
    rateSource: "chapter-default",
    effectiveFrom: "2025-09-22",
    active: true,
    tradeTerms: [],
    ...overrides,
  };
}

describe("buildExamples", () => {
  it("turns curated trade terms into labelled examples", () => {
    const { examples } = buildExamples(
      [heading("7320", { tradeTerms: ["disc spring", "Belleville washer"] })],
      [],
    );
    const lexicon = examples.filter((e) => e.source === "lexicon");
    expect(lexicon.map((e) => e.text)).toEqual(["disc spring", "Belleville washer"]);
    expect(lexicon.every((e) => e.heading === "7320" && e.chapter === "73")).toBe(true);
  });

  it("weights curated vocabulary above tariff prose", () => {
    const { examples } = buildExamples([heading("7320", { tradeTerms: ["disc spring"] })], []);
    const lexicon = examples.find((e) => e.source === "lexicon")!;
    const tariff = examples.find((e) => e.source === "tariff")!;
    expect(lexicon.weight).toBeGreaterThan(tariff.weight);
  });

  it("includes descendant descriptions as examples for their heading", () => {
    const tariff: TariffRow[] = [
      { code: "730721", description: "FLANGES", codeLength: 6 },
      { code: "730722", description: "THREADED ELBOWS, BENDS AND SLEEVES", codeLength: 6 },
    ];
    const { examples } = buildExamples([heading("7307")], tariff);
    const texts = examples.map((e) => e.text);
    expect(texts).toContain("THREADED ELBOWS, BENDS AND SLEEVES");
    expect(examples.every((e) => e.heading === "7307")).toBe(true);
  });

  it("drops descendants that say nothing on their own", () => {
    // 6-digit rows are very often literally "OTHER"; as a standalone example that would teach the
    // model that the word "other" means this heading.
    const tariff: TariffRow[] = [
      { code: "730719", description: "OTHER", codeLength: 6 },
      { code: "730729", description: "Other :", codeLength: 6 },
    ];
    const { examples } = buildExamples([heading("7307")], tariff);
    expect(examples.filter((e) => e.text.toLowerCase().includes("other"))).toHaveLength(0);
  });

  it("qualifies a short descendant with its heading so it carries context", () => {
    const tariff: TariffRow[] = [{ code: "730721", description: "FLANGES", codeLength: 6 }];
    const { examples } = buildExamples(
      [heading("7307", { displayName: "Tube or pipe fittings" })],
      tariff,
    );
    expect(examples.map((e) => e.text)).toContain("Tube or pipe fittings: FLANGES");
  });

  it("ignores descendants of a heading that is not in the sheet", () => {
    const tariff: TariffRow[] = [{ code: "999999", description: "SOMETHING", codeLength: 6 }];
    const { examples } = buildExamples([heading("7307")], tariff);
    expect(examples.some((e) => e.text === "SOMETHING")).toBe(false);
  });

  it("skips inactive headings entirely", () => {
    const { examples } = buildExamples(
      [heading("7307", { active: false, tradeTerms: ["socket"] })],
      [],
    );
    expect(examples).toHaveLength(0);
  });

  it("drops a term claimed by two headings entirely, rather than giving it to whichever came first", () => {
    // Almost always a trade term typed against the wrong row in the sheet.
    const { examples, conflicts } = buildExamples(
      [
        heading("7307", { tradeTerms: ["washer"] }),
        heading("7318", { tradeTerms: ["washer"] }),
      ],
      [],
    );
    expect(examples.filter((e) => e.text === "washer")).toHaveLength(0);
    expect(conflicts.join(" ")).toContain("7307");
    expect(conflicts.join(" ")).toContain("7318");
  });

  it("drops tariff text that several headings share, because it cannot discriminate", () => {
    // Real: "PURE-BRED BREEDING ANIMALS" sits under 0101 (horses), 0102 (cattle) and 0103 (swine).
    // Keeping the first would teach the model that the phrase means horses.
    const tariff: TariffRow[] = [
      { code: "010121", description: "PURE-BRED BREEDING ANIMALS", codeLength: 6 },
      { code: "010221", description: "PURE-BRED BREEDING ANIMALS", codeLength: 6 },
    ];
    const { examples, conflicts } = buildExamples([heading("0101"), heading("0102")], tariff);
    expect(examples.some((e) => e.text === "PURE-BRED BREEDING ANIMALS")).toBe(false);
    expect(conflicts.some((c) => c.includes("PURE-BRED"))).toBe(true);
  });

  it("lets a curated trade term win over generic tariff prose that collides with it", () => {
    const tariff: TariffRow[] = [
      { code: "731815", description: "disc spring", codeLength: 6 },
    ];
    const { examples } = buildExamples(
      [heading("7320", { tradeTerms: ["disc spring"] }), heading("7318")],
      tariff,
    );
    const match = examples.filter((e) => e.text === "disc spring");
    expect(match).toHaveLength(1);
    expect(match[0]!.heading).toBe("7320");
    expect(match[0]!.source).toBe("lexicon");
  });

  it("caps a runaway heading so one class cannot dominate the corpus", () => {
    const tariff: TariffRow[] = Array.from({ length: 80 }, (_, i) => ({
      code: `8544${String(i).padStart(2, "0")}`,
      description: `DISTINCT CABLE DESCRIPTION NUMBER ${i} OF SOME LENGTH`,
      codeLength: 8,
    }));
    const { examples } = buildExamples([heading("8544")], tariff);
    expect(examples.filter((e) => e.source === "tariff").length).toBeLessThanOrEqual(41);
  });
});

describe("splitExamples", () => {
  const make = (heading: string, text: string, source: TrainingExample["source"]): TrainingExample => ({
    text,
    heading,
    chapter: heading.slice(0, 2),
    source,
    weight: 1,
  });

  it("keeps a heading with too few examples entirely in train", () => {
    // Headings bottom out at a single example; holding it out would leave the class untrained.
    const { train, validation } = splitExamples([make("7320", "only one", "tariff")]);
    expect(train).toHaveLength(1);
    expect(validation).toHaveLength(0);
  });

  it("holds out tariff text rather than the scarce curated vocabulary", () => {
    const examples = [
      make("7320", "disc spring", "lexicon"),
      make("7320", "tariff a", "tariff"),
      make("7320", "tariff b", "tariff"),
      make("7320", "tariff c", "tariff"),
      make("7320", "tariff d", "tariff"),
    ];
    const { train, validation } = splitExamples(examples);
    expect(validation.every((e) => e.source === "tariff")).toBe(true);
    expect(train.some((e) => e.source === "lexicon")).toBe(true);
  });

  it("is deterministic, so metrics stay comparable between runs", () => {
    const examples = Array.from({ length: 10 }, (_, i) => make("7320", `text ${i}`, "tariff"));
    const first = splitExamples(examples);
    const second = splitExamples([...examples].reverse());
    expect(second.validation.map((e) => e.text).sort()).toEqual(
      first.validation.map((e) => e.text).sort(),
    );
  });
});

describe("summarise", () => {
  it("reports how many headings actually have curated vocabulary", () => {
    const { examples } = buildExamples(
      [heading("7320", { tradeTerms: ["disc spring"] }), heading("7307")],
      [],
    );
    const stats = summarise(examples);
    expect(stats.headings).toBe(2);
    expect(stats.headingsWithLexicon).toBe(1);
    expect(stats.chapters).toBe(1);
  });
});
