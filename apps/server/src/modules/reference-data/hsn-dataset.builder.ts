import type { LookupRow } from "./hsn-gst-lookup.js";

/**
 * Builds the labelled text corpus the classifier trains on, from the two sources that exist:
 * CBIC's own tariff text, and the trade vocabulary the user curates in the lookup sheet.
 *
 * Why both: the official text does not contain the words people actually write on a purchase
 * order. Heading 7320's descendants say "LEAF-SPRINGS", "HELICAL SPRINGS", "COIL SPRING" and
 * "SPRING PINS" — never "disc spring" or "Belleville washer". Training on tariff text alone
 * teaches the model tariff-speak, which is not the language of the input it will see.
 */

export type ExampleSource = "tariff" | "lexicon" | "real";

export interface TrainingExample {
  text: string;
  /** 4-digit heading — the label, and also the item's HSN code. */
  heading: string;
  /** 2-digit chapter, for the coarse head and for stratified splitting. */
  chapter: string;
  source: ExampleSource;
  /** Lower for weaker signal; the trainer uses it to weight the loss. */
  weight: number;
}

export interface TariffRow {
  code: string;
  description: string;
  codeLength: number;
}

/** Descendant descriptions this uninformative carry no signal without their parent's text. */
const UNINFORMATIVE = /^(other|others|other\s*:|—|-+)$/i;

const WEIGHT_BY_SOURCE: Record<ExampleSource, number> = {
  // A human curated it against this specific code, in the words real documents use.
  lexicon: 1.0,
  // Official and correct, but written in tariff register rather than procurement register.
  tariff: 0.6,
  real: 1.0,
};

/** Caps runaway classes: heading 8544 has 59 descendants, 7320 has 11. */
const MAX_TARIFF_EXAMPLES_PER_HEADING = 40;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Descendant text, qualified by its heading when it cannot stand alone. 6-digit rows are very
 * often literally "OTHER" or "FLANGES", which as a standalone training example would teach the
 * model that the word "other" means heading 7307.
 */
function descendantText(headingName: string, description: string): string | null {
  const body = clean(description).replace(/\s*:\s*$/, "");
  if (!body) return null;
  if (UNINFORMATIVE.test(body)) return null;
  // Short or generic fragments get the heading prepended so they carry their own context.
  return body.length < 25 ? `${headingName}: ${body}` : body;
}

/**
 * One example per distinct text. Duplicates are dropped rather than up-weighted — the same string
 * appearing under two headings is a label conflict, and silently training on both teaches noise.
 */
export function buildExamples(
  sheet: LookupRow[],
  tariff: TariffRow[],
): { examples: TrainingExample[]; conflicts: string[] } {
  const headings = sheet.filter((row) => row.level === "heading" && row.active);
  const headingByCode = new Map(headings.map((row) => [row.code, row]));

  const descendantsByHeading = new Map<string, TariffRow[]>();
  for (const row of tariff) {
    if (row.codeLength <= 4) continue;
    const parent = row.code.slice(0, 4);
    if (!headingByCode.has(parent)) continue;
    const list = descendantsByHeading.get(parent);
    if (list) list.push(row);
    else descendantsByHeading.set(parent, [row]);
  }

  // Collected first, resolved second: whether a text can be trained on depends on how many
  // headings end up claiming it, which is not knowable while still walking them.
  const candidates: { text: string; heading: string; source: ExampleSource }[] = [];
  const push = (text: string, heading: string, source: ExampleSource) => {
    candidates.push({ text, heading, source });
  };

  for (const heading of headings) {
    // The trade vocabulary the user owns — highest signal, so it goes in first and wins any
    // duplicate against tariff text.
    for (const term of heading.tradeTerms) {
      const text = clean(term);
      if (text) push(text, heading.code, "lexicon");
    }

    const official = clean(heading.officialDescription);
    if (official) push(official, heading.code, "tariff");

    const descendants = descendantsByHeading.get(heading.code) ?? [];
    let added = 0;
    for (const descendant of descendants) {
      if (added >= MAX_TARIFF_EXAMPLES_PER_HEADING) break;
      const text = descendantText(heading.displayName, descendant.description);
      if (!text) continue;
      push(text, heading.code, "tariff");
      added += 1;
    }
  }

  const byText = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = candidate.text.toLowerCase();
    const list = byText.get(key);
    if (list) list.push(candidate);
    else byText.set(key, [candidate]);
  }

  const examples: TrainingExample[] = [];
  const conflicts: string[] = [];

  for (const group of byText.values()) {
    const headingsClaiming = new Set(group.map((c) => c.heading));
    let winner = group[0]!;

    if (headingsClaiming.size > 1) {
      // Curated vocabulary outranks tariff prose: someone deliberately wrote this term against this
      // code, whereas the tariff repeats generic phrasing across unrelated headings.
      const curated = group.filter((c) => c.source === "lexicon");
      const curatedHeadings = new Set(curated.map((c) => c.heading));

      if (curatedHeadings.size === 1) {
        winner = curated[0]!;
      } else {
        // Either several headings claim it in the sheet (a user mistake), or it is tariff text
        // shared across headings — "PURE-BRED BREEDING ANIMALS" sits under horses, cattle and
        // swine. Either way it carries no signal about which heading is right, so nothing is
        // trained on it. Keeping whichever came first would just teach the model the wrong one.
        conflicts.push(`${winner.text} (${[...headingsClaiming].sort().join(" vs ")})`);
        continue;
      }
    }

    examples.push({
      text: winner.text,
      heading: winner.heading,
      chapter: winner.heading.slice(0, 2),
      source: winner.source,
      weight: WEIGHT_BY_SOURCE[winner.source],
    });
  }

  return { examples, conflicts };
}

export function summarise(examples: TrainingExample[]): {
  total: number;
  headings: number;
  chapters: number;
  bySource: Record<string, number>;
  headingsWithLexicon: number;
  minPerHeading: number;
  medianPerHeading: number;
} {
  const perHeading = new Map<string, number>();
  const lexiconHeadings = new Set<string>();
  const bySource: Record<string, number> = {};

  for (const example of examples) {
    perHeading.set(example.heading, (perHeading.get(example.heading) ?? 0) + 1);
    bySource[example.source] = (bySource[example.source] ?? 0) + 1;
    if (example.source === "lexicon") lexiconHeadings.add(example.heading);
  }

  const counts = [...perHeading.values()].sort((a, b) => a - b);
  return {
    total: examples.length,
    headings: perHeading.size,
    chapters: new Set(examples.map((e) => e.chapter)).size,
    bySource,
    headingsWithLexicon: lexiconHeadings.size,
    minPerHeading: counts[0] ?? 0,
    medianPerHeading: counts[Math.floor(counts.length / 2)] ?? 0,
  };
}

/**
 * Stratified split, per heading, so every heading is represented in train even when it has a
 * single example. Validation only gets a heading that has enough examples to spare one.
 */
export function splitExamples(
  examples: TrainingExample[],
  validationFraction = 0.15,
): { train: TrainingExample[]; validation: TrainingExample[] } {
  const byHeading = new Map<string, TrainingExample[]>();
  for (const example of examples) {
    const list = byHeading.get(example.heading);
    if (list) list.push(example);
    else byHeading.set(example.heading, [example]);
  }

  const train: TrainingExample[] = [];
  const validation: TrainingExample[] = [];

  for (const list of byHeading.values()) {
    // Deterministic: sorted by text, so a rebuild produces the same split and metrics stay
    // comparable across runs.
    const sorted = [...list].sort((a, b) => a.text.localeCompare(b.text));
    const holdOut = sorted.length < 4 ? 0 : Math.max(1, Math.round(sorted.length * validationFraction));
    // Prefer holding out tariff text: lexicon terms are the scarce, high-signal examples.
    const candidates = sorted.filter((e) => e.source === "tariff").slice(0, holdOut);
    const heldOut = new Set(candidates);

    for (const example of sorted) {
      if (heldOut.has(example)) validation.push(example);
      else train.push(example);
    }
  }

  return { train, validation };
}
