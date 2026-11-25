import { describe, expect, it, vi } from "vitest";

import { createQuotePasteAiReader } from "../quote-paste-ai.js";
import type { PasteItem, UnreadLine } from "../text-quote-parser.js";

const ITEMS: PasteItem[] = Array.from({ length: 13 }, (_, i) => ({
  description: i === 0 ? "O RING (12X1) MM" : `O RING (${i + 20}X2) MM`,
  quantity: 150,
  unit: "EA",
}));

const LINE: UnreadLine = { lineIndex: 4, text: "all 33mm ones 25 each", reason: "No matching item" };
const TEMPLATE = "ITEMS:\n{{items}}\nLINES:\n{{lines}}";

function reader(answer: unknown | (() => Promise<unknown>)) {
  const generate = vi.fn(typeof answer === "function" ? (answer as () => Promise<unknown>) : async () => answer);
  const read = createQuotePasteAiReader({ getTemplate: async () => TEMPLATE, generate });
  return { read, generate };
}

describe("createQuotePasteAiReader", () => {
  it("does not call the model with no lines", async () => {
    const { read, generate } = reader({ lines: [] });
    const result = await read(ITEMS, [], new Set());
    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({ matches: [], remaining: [], notice: null });
  });

  it("renders items and lines into the template and passes a schema", async () => {
    const { read, generate } = reader({ lines: [] });
    await read(ITEMS, [LINE], new Set());
    const [prompt, schema] = generate.mock.calls[0]!;
    expect(prompt).toContain("1) O RING (12X1) MM - Qty - 150 EA");
    expect(prompt).toContain("L4: all 33mm ones 25 each");
    expect(schema).toMatchObject({ type: "object", required: ["lines"] });
  });

  it("accepts a grounded answer", async () => {
    const { read } = reader({ lines: [{ line: "L4", itemNumber: 13, rate: 25, regretted: false }] });
    const result = await read(ITEMS, [LINE], new Set());
    expect(result.matches).toEqual([
      { itemIndex: 12, lineIndex: 4, rate: 25, regretted: false, vendorQuantity: null, source: "ai", warnings: [] },
    ]);
    expect(result.remaining).toEqual([]);
    expect(result.notice).toBeNull();
  });

  it("drops an invented rate", async () => {
    const { read } = reader({ lines: [{ line: "L4", itemNumber: 13, rate: 30, regretted: false }] });
    const result = await read(ITEMS, [LINE], new Set());
    expect(result.matches).toEqual([]);
    expect(result.remaining).toEqual([LINE]);
  });

  it("drops a rate that is only our echoed quantity", async () => {
    const line = { ...LINE, text: "2) O RING (22X2) MM - Qty - 150 EA" };
    const { read } = reader({ lines: [{ line: "L4", itemNumber: 2, rate: 150, regretted: false }] });
    expect((await read(ITEMS, [line], new Set())).matches).toEqual([]);
  });

  it("matches rate digits ignoring commas", async () => {
    const line = { ...LINE, text: "big ring 1,250 only" };
    const { read } = reader({ lines: [{ line: "L4", itemNumber: 2, rate: 1250, regretted: false }] });
    expect((await read(ITEMS, [line], new Set())).matches).toHaveLength(1);
  });

  it("drops out-of-range and taken items", async () => {
    const lines = [LINE, { lineIndex: 5, text: "ring 40", reason: "No rate found" }];
    const { read } = reader({
      lines: [
        { line: "L4", itemNumber: 99, rate: 25, regretted: false },
        { line: "L5", itemNumber: 1, rate: 40, regretted: false },
      ],
    });
    const result = await read(ITEMS, lines, new Set([0]));
    expect(result.matches).toEqual([]);
    expect(result.remaining).toEqual(lines);
  });

  it("drops unknown line ids and rate+regret together", async () => {
    const { read } = reader({
      lines: [
        { line: "L9", itemNumber: 2, rate: 25, regretted: false },
        { line: "L4", itemNumber: 2, rate: 25, regretted: true },
      ],
    });
    const result = await read(ITEMS, [LINE], new Set());
    expect(result.matches).toEqual([]);
  });

  it("accepts a regret with no rate", async () => {
    const line = { lineIndex: 2, text: "sorry cannot do the 22mm", reason: "No rate found" };
    const { read } = reader({ lines: [{ line: "L2", itemNumber: 2, rate: null, regretted: true }] });
    expect((await read(ITEMS, [line], new Set())).matches[0]).toMatchObject({ itemIndex: 1, regretted: true, rate: null });
  });

  it("does not let two AI answers claim one item", async () => {
    const lines = [LINE, { lineIndex: 6, text: "33 ring 25", reason: "No matching item" }];
    const { read } = reader({
      lines: [
        { line: "L4", itemNumber: 13, rate: 25, regretted: false },
        { line: "L6", itemNumber: 13, rate: 25, regretted: false },
      ],
    });
    const result = await read(ITEMS, lines, new Set());
    expect(result.matches.map((m) => m.lineIndex)).toEqual([4]);
    expect(result.remaining.map((l) => l.lineIndex)).toEqual([6]);
  });

  it("degrades when the model fails", async () => {
    const { read } = reader(async () => {
      throw new Error("Ollama not reachable");
    });
    const result = await read(ITEMS, [LINE], new Set());
    expect(result).toEqual({
      matches: [],
      remaining: [LINE],
      notice: "AI reader unavailable — 1 lines left for you to fill",
    });
  });

  it("degrades when the answer has the wrong shape", async () => {
    const { read } = reader({ nope: true });
    expect((await read(ITEMS, [LINE], new Set())).notice).toBe("AI reader unavailable — 1 lines left for you to fill");
  });
});
