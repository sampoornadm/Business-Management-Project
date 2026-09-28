/**
 * Nearest-text classification, and the decision about when not to answer.
 *
 * An item is classified by the single closest training text, and takes that text's heading — not by
 * the closest class centroid. Measured on real purchase-order lines that is worth 68.4% against
 * 50.0%, and the mechanism is specific: a centroid averages a heading's texts, so heading 7320's two
 * curated terms are outvoted by its eleven rows of tariff prose. A disc-spring washer then lands on
 * 7318, whose own tariff text reads "washers (including spring washers)" — the exact trap that
 * produced the wrong codes this project started from. Nearest text lets one curated term stand on
 * its own, which is also what makes the lookup sheet's trade_terms column an effective lever.
 *
 * Exhaustive rather than approximate: 9,490 vectors of 384 floats is a 14 MB scan that takes
 * microseconds and is exact. An ANN index would add a migration and a failure mode to avoid work
 * that is not worth avoiding.
 */

export interface IndexEntry {
  heading: string;
  /** L2-normalised, so cosine against a normalised query is a plain dot product. */
  vector: Float32Array;
  /** Where the text came from: "lexicon" for a curated trade term, "tariff" for CBIC's own prose. */
  source: string;
}

/**
 * How far to trust a match by where its text came from.
 *
 * A curated trade term was written by a person against that specific code; tariff prose is generic
 * and sometimes actively misleading. A mild steel pipe socket matched "STOCKINGS, SOCKS, SOCKETTES
 * AND THE LIKE, OF COTTON" (6217) at 0.636, beating the curated term "socket" (7307) at 0.566 —
 * surface form winning over meaning.
 *
 * 0.85 is measured, not chosen for feel. Across 933 held-out headings it gains 3.8 points on
 * headings that have curated terms and costs 0.4 on those that do not; 0.6 gains a further 6 there
 * but collapses the non-curated headings by 19 points. The 76 real items cannot show that harm —
 * they cover 6 headings, every one of them curated — so do not retune this against them alone.
 */
export const SOURCE_WEIGHTS: Record<string, number> = { lexicon: 1, tariff: 0.85 };

export interface Candidate {
  headingCode: string;
  chapterCode: string;
  similarity: number;
}

export interface Classification {
  headingCode: string | null;
  chapterCode: string | null;
  similarity: number;
  /** Gap to the best text of a different heading. Small means the two are interchangeable. */
  margin: number;
  confidence: number;
  abstained: boolean;
  alternatives: Candidate[];
}

export interface ClassifyOptions {
  minConfidence: number;
  /** How many runner-up headings to report, for a reviewer judging the suggestion. */
  alternatives?: number;
}

const EMPTY: Classification = {
  headingCode: null,
  chapterCode: null,
  similarity: 0,
  margin: 0,
  confidence: 0,
  abstained: true,
  alternatives: [],
};

function dot(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i]! * b[i]!;
  return total;
}

/**
 * Confidence from the top similarity and the gap to the next heading.
 *
 * Both matter and neither is enough alone. High similarity with a hair-thin margin means several
 * headings fit equally well — the documented case where 7320 beat 7318 by 0.001 looked perfectly
 * confident on similarity. A wide margin over a weak best match means nothing fits.
 */
function confidenceOf(similarity: number, margin: number): number {
  const clamped = Math.max(0, Math.min(1, similarity));
  // Margins are small in absolute terms, so scale before combining or the term contributes nothing.
  const separation = Math.max(0, Math.min(1, margin * 10));
  return clamped * separation;
}

export function classifyAgainst(
  query: Float32Array,
  index: IndexEntry[],
  options: ClassifyOptions,
): Classification {
  if (index.length === 0) return EMPTY;

  // Best similarity per heading. Several texts of one heading scoring highly is agreement, not
  // ambiguity, so they must not be read as a contested decision.
  const bestByHeading = new Map<string, number>();
  for (const entry of index) {
    // An unknown source keeps full weight: a new kind of training text should be under-used only
    // deliberately, never because nobody added it here.
    const similarity = dot(query, entry.vector) * (SOURCE_WEIGHTS[entry.source] ?? 1);
    const previous = bestByHeading.get(entry.heading);
    if (previous === undefined || similarity > previous) bestByHeading.set(entry.heading, similarity);
  }

  const ranked = [...bestByHeading.entries()]
    .map(([headingCode, similarity]) => ({
      headingCode,
      chapterCode: headingCode.slice(0, 2),
      similarity,
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const best = ranked[0]!;
  const runnerUp = ranked[1];
  // A single heading has nothing to be confused with, so treat it as fully separated rather than as
  // a zero margin, which would abstain on everything.
  const margin = runnerUp ? best.similarity - runnerUp.similarity : 1;
  const confidence = confidenceOf(best.similarity, margin);
  const abstained = confidence < options.minConfidence;

  return {
    headingCode: abstained ? null : best.headingCode,
    chapterCode: abstained ? null : best.chapterCode,
    similarity: best.similarity,
    margin,
    confidence,
    abstained,
    alternatives: ranked.slice(1, 1 + (options.alternatives ?? 3)),
  };
}
