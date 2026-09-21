import { describe, expect, it, vi } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { parseMessage } from "../assistant.parser.js";
import { extractTerms, heuristicTerms, normalizeTerm, singularize } from "../assistant.terms.js";

describe("singularize / normalizeTerm", () => {
  it.each([
    ["washers", "washer"],
    ["gaskets", "gasket"],
    ["batteries", "battery"],
    ["switches", "switch"],
    ["boxes", "box"],
    ["glasses", "glass"],
    ["valves", "valve"],
    ["brass", "brass"],
    ["gas", "gas"],
    ["bus", "bus"],
    ["M8", "M8"],
  ])("%s -> %s", (input, expected) => expect(singularize(input)).toBe(expected));

  it("normalizes every word of a phrase and strips stray punctuation", () => {
    expect(normalizeTerm("stainless steel 304 pipes?")).toBe("stainless steel 304 pipe");
    expect(normalizeTerm("flat washers M8")).toBe("flat washer M8");
  });
});

describe("extractTerms (LLM path)", () => {
  const ok = (value: unknown) => vi.fn().mockResolvedValue(value);

  it("passes a JSON schema, a timeout and temperature 0 to the model", async () => {
    const generate = ok({ itemTerms: ["washer"], partyText: null });
    await extractTerms("tenders for washers", "for washers", generate);
    const options = generate.mock.calls[0]![2];
    expect(options).toMatchObject({ temperature: 0, timeoutMs: 15_000 });
    expect(options.schema).toMatchObject({ required: ["itemTerms", "partyText"] });
  });

  it("returns cleaned, singular terms", async () => {
    const r = await extractTerms("tenders for washers and bolts", "", ok({ itemTerms: ["Washers", "bolts"], partyText: null }));
    expect(r).toEqual({ itemTerms: ["Washer", "bolt"], partyText: null, source: "llm" });
  });

  it("drops empties, filler echoes and hallucinated words", async () => {
    const r = await extractTerms(
      "tenders quoted last month for washers",
      "",
      ok({ itemTerms: ["", "tenders", "last month", "gasket", "washers", "washer"], partyText: null }),
    );
    expect(r.itemTerms).toEqual(["washer"]);
  });

  it("keeps a party only if it appears in the message", async () => {
    expect((await extractTerms("lost ones from Meridian", "", ok({ itemTerms: [], partyText: "Meridian" }))).partyText).toBe("Meridian");
    expect((await extractTerms("lost ones", "", ok({ itemTerms: [], partyText: "Acme" }))).partyText).toBeNull();
  });

  it("falls back to the heuristic when Ollama is unavailable or times out", async () => {
    const down = vi.fn().mockRejectedValue(new ServiceUnavailableError("down"));
    const r = await extractTerms("tenders quoted last month for washers", "show me which I for washers", down);
    expect(r).toMatchObject({ itemTerms: ["washer"], source: "heuristic" });
  });

  it("falls back when the model output does not match the schema", async () => {
    const r = await extractTerms("tenders for washers", "for washers", ok({ nope: true }));
    expect(r).toMatchObject({ itemTerms: ["washer"], source: "heuristic" });
  });

  it("rethrows unexpected errors instead of hiding bugs", async () => {
    await expect(extractTerms("x", "x", vi.fn().mockRejectedValue(new TypeError("boom")))).rejects.toThrow("boom");
  });
});

describe("heuristicTerms", () => {
  it("reads items after for/of/with/containing", () => {
    expect(heuristicTerms("for washers", "tenders for washers").itemTerms).toEqual(["washer"]);
    expect(heuristicTerms("with M8 hex bolts and gaskets", "RFQs with M8 hex bolts and gaskets").itemTerms).toEqual(["M8 hex bolt", "gasket"]);
  });

  it("finds a capitalised party after from/by/to", () => {
    const message = "bills for cable glands sent to Apex Electricals";
    const r = heuristicTerms(parseMessage(message, new Date(), "Asia/Kolkata").residual, message);
    expect(r.partyText).toBe("Apex Electricals");
    expect(r.itemTerms).toEqual(["cable gland"]);
  });

  it("returns nothing rather than guessing", () => {
    expect(heuristicTerms("show me the", "show me the ones which I won")).toEqual({ itemTerms: [], partyText: null });
  });
});
