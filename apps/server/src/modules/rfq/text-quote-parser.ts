import { specNumbers } from "../../shared/utils/spec-match.js";

/**
 * Reads a vendor's pasted text reply into per-item rates by rule, with no model involved. Lines it
 * cannot read are returned as `unread` for the AI fallback (quote-paste-ai.ts) — never guessed
 * here. Item i is "Sl No i+1", the same numbering buildRfqItemListText sends the vendor.
 *
 * The one failure this must never have is a rate silently landing on the wrong item, so a
 * serial number is cross-checked against the line's sizes, and a description match needs the
 * item's spec numbers (12X1 vs 12X1.5) — words alone only decide among items without sizes.
 */

export interface PasteItem {
  description: string;
  quantity: number;
  unit: string | null;
}

export interface PasteLine {
  lineIndex: number;
  text: string;
}

export interface PasteMatch {
  itemIndex: number;
  lineIndex: number;
  rate: number | null;
  regretted: boolean;
  vendorQuantity: number | null;
  source: "serial" | "description" | "ai";
  warnings: string[];
}

export interface UnreadLine extends PasteLine {
  reason: string;
}

export interface ParsedQuoteText {
  matches: PasteMatch[];
  unread: UnreadLine[];
  gstMentioned: boolean;
}

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const CURRENCY = String.raw`(?:\brs\.?|₹|\binr\b)`;
// Chat-export prefix before a message, e.g. "[20/11, 10:42 am] Name: ".
const CHAT_HEADER = /^\[[^\]]*\]\s*[^:]{1,60}:\s*/;
// "1 ", "1.", "1)", "1 -", "1:", "1|", "1<tab>" — but not "10.5X3" or "150@10".
const SERIAL = /^\s*(\d{1,3})(?:\.\s|\)|\s*[-:|]|\s+)/;
const REGRET = /\bregret|\bnot\s+available\b|\bn\/a\b|\bna\b|\bnot\s+quoting\b|\bno\s+quote\b|\bnil\b/i;
const GST = /\bgst\b|\bincl(?:usive)?\b|\+\s*18\s*%|\bextra\b/i;
// Words that can sit next to a bare price without being a description ("3 - 450 per mtr").
const PRICE_WORDS = new Set([
  "rs", "inr", "rupees", "each", "per", "only", "nos", "no", "pcs", "pc", "ea", "mtr", "mtrs", "m",
  "kg", "set", "sets", "unit", "rate", "regret", "regretted", "not", "available", "na", "nil", "quote", "quoting",
]);

interface PriceHit {
  rate: number;
  vendorQuantity: number | null;
  start: number;
  end: number;
}

const toNumber = (raw: string) => Number(raw.replace(/,/g, ""));

/** Removes text[start, end) — one occurrence, so a size equal to the rate survives. */
const cut = (text: string, start: number, end: number) => `${text.slice(0, start)} ${text.slice(end)}`;

function findPrice(text: string): PriceHit | null {
  const patterns: Array<{ re: RegExp; rateGroup: number; qtyGroup?: number }> = [
    // Our own sent line echoed back with a rate: "... - Qty - 100 Mtr - 450".
    {
      re: new RegExp(`\\bqty\\s*[-:]\\s*${NUM}\\s*[a-z. ]*?\\s*[-:=@]\\s*${CURRENCY}?\\s*${NUM}`, "i"),
      qtyGroup: 1,
      rateGroup: 2,
    },
    { re: new RegExp(`${NUM}\\s*@\\s*${CURRENCY}?\\s*${NUM}`, "i"), qtyGroup: 1, rateGroup: 2 },
    { re: new RegExp(`@\\s*${CURRENCY}?\\s*${NUM}`, "i"), rateGroup: 1 },
    { re: new RegExp(`${CURRENCY}\\s*${NUM}`, "i"), rateGroup: 1 },
    { re: new RegExp(`${NUM}\\s*\\/-`), rateGroup: 1 },
  ];
  for (const { re, rateGroup, qtyGroup } of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const rate = toNumber(m[rateGroup]!);
    if (!(rate > 0)) continue;
    return {
      rate,
      vendorQuantity: qtyGroup ? toNumber(m[qtyGroup]!) : null,
      start: m.index,
      end: m.index + m[0].length,
    };
  }

  // A table row whose whole last cell is a number: "desc | unit | 450".
  const cells = text.split(/\t|\|/).map((c) => c.trim()).filter(Boolean);
  const last = cells[cells.length - 1];
  if (cells.length >= 3 && last && new RegExp(`^${NUM}$`).test(last)) {
    const rate = toNumber(last);
    const start = text.lastIndexOf(last);
    if (rate > 0) return { rate, vendorQuantity: null, start, end: start + last.length };
  }

  // A bare price: exactly one number and nothing but price words around it ("3 - 450").
  const numbers = [...text.matchAll(new RegExp(NUM, "g"))];
  if (numbers.length === 1 && words(text).every((w) => PRICE_WORDS.has(w))) {
    const m = numbers[0]!;
    const rate = toNumber(m[1]!);
    if (rate > 0) return { rate, vendorQuantity: null, start: m.index!, end: m.index! + m[0].length };
  }
  return null;
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

/** Distinct words of 3+ letters, minus price/regret vocabulary — what a description is made of. */
function descriptionWords(text: string): Set<string> {
  return new Set(words(text).filter((w) => w.length >= 3 && !PRICE_WORDS.has(w)));
}

/** True when every number in `needles` appears in `haystack`, counting repeats. */
function containsAll(haystack: string[], needles: string[]): boolean {
  const pool = [...haystack];
  return needles.every((n) => {
    const at = pool.indexOf(n);
    if (at === -1) return false;
    pool.splice(at, 1);
    return true;
  });
}

/** The single item this leftover text describes, or null when it is ambiguous or matches none. */
function matchDescription(leftover: string, items: PasteItem[], itemSpecs: string[][]): number | null {
  const lineSpecs = specNumbers(leftover);
  const sized = items.map((_, i) => i).filter((i) => itemSpecs[i]!.length > 0);

  const exact = sized.filter((i) => {
    const spec = itemSpecs[i]!;
    return spec.length === lineSpecs.length && containsAll(lineSpecs, spec);
  });
  if (exact.length === 1) return exact[0]!;

  const contained = sized.filter((i) => containsAll(lineSpecs, itemSpecs[i]!));
  if (contained.length === 1) return contained[0]!;

  // Words only break a tie between items whose sizes already fit, or pick among items that
  // have no sizes at all — never across sizes, which is how 12X1 would end up on 12X1.5.
  const pool = contained.length > 0 ? contained : items.map((_, i) => i).filter((i) => itemSpecs[i]!.length === 0);
  const lineWords = descriptionWords(leftover);
  const scored = pool
    .map((i) => ({ i, score: [...descriptionWords(items[i]!.description)].filter((w) => lineWords.has(w)).length }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  // ponytail: fixed margin (2 shared words, 2x the runner-up), tune if real pastes need it
  if (best && best.score >= 2 && best.score >= 2 * (second?.score ?? 0)) return best.i;
  return null;
}

/** The paste's raw lines, index = lineIndex everywhere in this module. */
export function splitPasteLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");
}

export function parseQuoteText(text: string, items: PasteItem[]): ParsedQuoteText {
  const itemSpecs = items.map((item) => specNumbers(item.description));
  const matches: PasteMatch[] = [];
  const unread: UnreadLine[] = [];
  const claimedBy = new Map<number, number>(); // itemIndex -> lineIndex

  splitPasteLines(text).forEach((raw, lineIndex) => {
    const line = raw.replace(CHAT_HEADER, "").trim();
    if (!/\d/.test(line) && !REGRET.test(line)) return; // greetings, sign-offs
    const original = raw.trim();

    let rest = line;
    let serial: number | null = null;
    const s = SERIAL.exec(line);
    if (s) {
      const n = Number(s[1]);
      if (n >= 1 && n <= items.length) {
        serial = n;
        rest = line.slice(s[0].length);
      }
    }

    const regretted = REGRET.test(rest);
    const price = regretted ? null : findPrice(rest);
    if (!regretted && !price) {
      unread.push({ lineIndex, text: original, reason: "No rate found" });
      return;
    }
    const leftover = price ? cut(rest, price.start, price.end) : rest;
    const hasDescription = descriptionWords(leftover).size > 0 || specNumbers(leftover).length > 0;

    let itemIndex: number | null = null;
    let source: PasteMatch["source"] = "serial";
    const warnings: string[] = [];
    if (serial !== null) {
      const own = serial - 1;
      if (!hasDescription || containsAll(specNumbers(leftover), itemSpecs[own]!)) {
        itemIndex = own;
      } else {
        const other = matchDescription(leftover, items, itemSpecs);
        if (other !== null && other !== own) {
          itemIndex = other;
          source = "description";
          warnings.push(`Serial ${serial} points at a different item`);
        } else {
          itemIndex = own;
          warnings.push(`Description doesn't match item ${serial}`);
        }
      }
    } else {
      itemIndex = matchDescription(leftover, items, itemSpecs);
      source = "description";
    }

    if (itemIndex === null) {
      unread.push({ lineIndex, text: original, reason: "No matching item" });
      return;
    }
    const earlier = claimedBy.get(itemIndex);
    if (earlier !== undefined) {
      unread.push({ lineIndex, text: original, reason: `Item ${itemIndex + 1} already matched by line ${earlier + 1}` });
      return;
    }
    claimedBy.set(itemIndex, lineIndex);

    const vendorQuantity = price?.vendorQuantity ?? null;
    const asked = items[itemIndex]!.quantity;
    if (vendorQuantity !== null && vendorQuantity !== asked) {
      warnings.push(`Vendor quoted for ${vendorQuantity}, RFQ asks ${asked}`);
    }
    matches.push({ itemIndex, lineIndex, rate: price?.rate ?? null, regretted, vendorQuantity, source, warnings });
  });

  return { matches, unread, gstMentioned: GST.test(text) };
}
