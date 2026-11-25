import { z } from "zod";

import { formatRfqItemTextLine } from "@bmp/types";

import { renderPrompt } from "../../infra/llm/prompts.js";

import { withoutQtyEcho, type PasteItem, type PasteMatch, type UnreadLine } from "./text-quote-parser.js";

/**
 * AI fallback for the text quote paste: only the lines the rule parser could not read go to
 * the local model, in one call. Every answer is checked against the vendor's own text before it
 * is accepted — a small model inventing a price is the failure that matters, so a rate whose
 * number is not literally on that line (outside our own echoed "Qty - 150") is dropped, and the
 * line stays for the user to fill.
 */

export type QuotePasteAiReader = (
  items: PasteItem[],
  lines: UnreadLine[],
  takenItemIndexes: Set<number>,
) => Promise<{ matches: PasteMatch[]; remaining: UnreadLine[]; notice: string | null }>;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          line: { type: "string" },
          itemNumber: { type: ["integer", "null"] },
          rate: { type: ["number", "null"] },
          regretted: { type: "boolean" },
        },
        required: ["line", "itemNumber", "rate", "regretted"],
      },
    },
  },
  required: ["lines"],
} as const;

const answerSchema = z.object({
  lines: z.array(
    z.object({
      line: z.string(),
      itemNumber: z.number().int().nullable(),
      rate: z.number().nullable(),
      regretted: z.boolean(),
    }),
  ),
});

/** Every number written on the line, commas dropped ("1,250" -> 1250). */
function numbersOn(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
}

export function createQuotePasteAiReader(deps: {
  getTemplate: () => Promise<string>;
  generate: (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;
}): QuotePasteAiReader {
  return async (items, lines, takenItemIndexes) => {
    if (lines.length === 0) return { matches: [], remaining: [], notice: null };

    let answer: z.infer<typeof answerSchema>;
    try {
      const prompt = renderPrompt(await deps.getTemplate(), {
        items: items.map((it, i) => formatRfqItemTextLine(i + 1, it)).join("\n"),
        lines: lines.map((l) => `L${l.lineIndex}: ${l.text}`).join("\n"),
      });
      answer = answerSchema.parse(await deps.generate(prompt, ANSWER_SCHEMA as unknown as Record<string, unknown>));
    } catch {
      return {
        matches: [],
        remaining: lines,
        notice: `AI reader unavailable — ${lines.length} lines left for you to fill`,
      };
    }

    const byId = new Map(lines.map((l) => [`L${l.lineIndex}`, l]));
    const taken = new Set(takenItemIndexes);
    const matched = new Set<number>(); // lineIndex
    const matches: PasteMatch[] = [];

    for (const a of answer.lines) {
      const line = byId.get(a.line);
      if (!line || matched.has(line.lineIndex) || a.itemNumber === null) continue;
      const itemIndex = a.itemNumber - 1;
      if (itemIndex < 0 || itemIndex >= items.length || taken.has(itemIndex)) continue;
      if (a.regretted === (a.rate !== null)) continue; // exactly one of rate / regret
      if (a.rate !== null && !(a.rate > 0 && numbersOn(withoutQtyEcho(line.text)).includes(a.rate))) continue;

      taken.add(itemIndex);
      matched.add(line.lineIndex);
      matches.push({
        itemIndex,
        lineIndex: line.lineIndex,
        rate: a.rate,
        regretted: a.regretted,
        vendorQuantity: null,
        source: "ai",
        warnings: [],
      });
    }

    return { matches, remaining: lines.filter((l) => !matched.has(l.lineIndex)), notice: null };
  };
}
