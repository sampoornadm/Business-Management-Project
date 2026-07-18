/**
 * Every number in a description, as a sorted multiset. This is the deterministic discriminator
 * for "same item" — deliberately NOT delegated to the embedding or the LLM, both of which were
 * measured failing at exactly this (bge-m3 scores "XLPE Cable 4C x16" closer to "…x25" than to
 * its own paraphrase; qwen3 calls "…x25" the same item). Getting it wrong puts a wrong unit rate
 * into a live bid, so it gets a boring, deterministic check. See boq-enrichment.service.ts.
 */
export function specNumbers(description: string): string[] {
  return (description.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))).sort();
}

/**
 * True when two descriptions share the exact same numeric specs. Does NOT catch a same-size /
 * different-material swap ("XLPE Cable 4C x16" vs "PVC Cable 4C x16" share {4, 16}) — that one is
 * caught by a cosine threshold instead. The two checks cover each other's blind spot, which is why
 * a confident match requires BOTH.
 */
export function sameSpec(a: string, b: string): boolean {
  const left = specNumbers(a);
  const right = specNumbers(b);
  return left.length === right.length && left.every((value, i) => value === right[i]);
}
