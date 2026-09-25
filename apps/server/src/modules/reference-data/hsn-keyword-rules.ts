export interface HsnKeywordMatch {
  code: string;
  description: string;
}

interface HsnKeywordRule {
  code: string;
  description: string;
  test: (description: string) => boolean;
}

const FITTING_WORDS =
  /\b(tee|elbow|bend|socket|nipple|plug|coupling|sleeve|union|cross|reducer|flange)\b/i;
/** IS:1239 is the Indian Standard for mild-steel tubes/tubulars and wrought steel fittings —
 * a valid material signal even when the description only gives the standard, not the word "steel". */
const IRON_STEEL_SIGNAL = /\bsteel\b|\biron\b|\bis\s*:?\s*1239\b/i;

/**
 * Deterministic override for item phrasing the ANN+LLM matcher in boq-enrichment.service.ts
 * measurably gets wrong. Grounded in CBIC 7307's own heading text ("TUBE OR PIPE FITTINGS (FOR
 * EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL") plus the standard IS:1239 steel-fitting
 * vocabulary. Verified against tender 1400014127's real BOQ: the embedding+LLM step scattered
 * these fittings across 7303-7308/7207/7208/7326/8547 (raw-tube headings, semi-finished steel,
 * an unrelated electrical-fitting heading) instead of the one correct heading, for 20 of 32 items.
 */
const HSN_KEYWORD_RULES: HsnKeywordRule[] = [
  {
    code: "7307",
    description: "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL",
    test: (description) => FITTING_WORDS.test(description) && IRON_STEEL_SIGNAL.test(description),
  },
];

export function matchHsnByKeyword(description: string): HsnKeywordMatch | null {
  for (const rule of HSN_KEYWORD_RULES) {
    if (rule.test(description)) return { code: rule.code, description: rule.description };
  }
  return null;
}
