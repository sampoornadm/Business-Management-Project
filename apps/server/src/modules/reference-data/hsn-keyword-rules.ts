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
/** "Belleville" names the spring shape itself, no ambiguity — the others still require a steel
 * signal since a bare "spring" word alone is too generic (springs exist in every material). */
const SPRING_WORDS = /\bbelleville\b|\b(disc|preload|coil|leaf)\s+spring\b/i;

/**
 * Deterministic overrides for item phrasing the ANN+LLM matcher in boq-enrichment.service.ts
 * measurably gets wrong — each grounded in its CBIC heading's own text, checked before the
 * ANN/LLM path runs at all.
 *
 * 7307: "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL" plus
 * the standard IS:1239 steel-fitting vocabulary. Verified against tender 1400014127's real BOQ:
 * the embedding+LLM step scattered these fittings across 7303-7308/7207/7208/7326/8547 (raw-tube
 * headings, semi-finished steel, an unrelated electrical-fitting heading) instead of the one
 * correct heading, for 20 of 32 items.
 *
 * 7320: "SPRINGS AND LEAVES FOR SPRINGS, OF IRON OR STEEL". Verified against tender 1400014205's
 * real BOQ (8 disc-spring-washer / bearing-preload-spring items, all spring steel 51CrV4 per
 * DIN 17221 — the same product family, should all get the same code): the embedding+LLM step
 * scattered them across 7310/7311/7318/7323/732210 instead. 7318 is the specific trap — its own
 * CBIC text literally says "WASHERS (INCLUDING SPRING WASHERS)", which reads as a plausible match
 * for an item whose description contains both "washer" and "spring" — but 7318's spring washers
 * are the simple split/toothed lock washer used under a bolt, not a disc spring/Belleville washer,
 * which is a load-bearing spring element and belongs under 7320 instead.
 */
const HSN_KEYWORD_RULES: HsnKeywordRule[] = [
  {
    code: "7307",
    description: "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS, ELBOWS, SLEEVES), OF IRON OR STEEL",
    test: (description) => FITTING_WORDS.test(description) && IRON_STEEL_SIGNAL.test(description),
  },
  {
    code: "7320",
    description: "SPRINGS AND LEAVES FOR SPRINGS, OF IRON OR STEEL",
    test: (description) =>
      /\bbelleville\b/i.test(description) ||
      (SPRING_WORDS.test(description) && IRON_STEEL_SIGNAL.test(description)),
  },
];

export function matchHsnByKeyword(description: string): HsnKeywordMatch | null {
  for (const rule of HSN_KEYWORD_RULES) {
    if (rule.test(description)) return { code: rule.code, description: rule.description };
  }
  return null;
}
