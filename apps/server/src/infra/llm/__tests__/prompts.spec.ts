import { describe, expect, it } from "vitest";

import { missingMarkers, renderPrompt, RFQ_QUOTE_PASTE_DEFAULT_PROMPT } from "../prompts.js";

describe("renderPrompt", () => {
  it("replaces every occurrence of a known marker and leaves unknown ones", () => {
    expect(renderPrompt("A {{x}} B {{x}} {{y}}", { x: "1" })).toBe("A 1 B 1 {{y}}");
  });

  it("does not interpret $ patterns in the inserted value", () => {
    expect(renderPrompt("{{x}}", { x: "Rs $& 10" })).toBe("Rs $& 10");
  });
});

describe("missingMarkers", () => {
  it("lists required markers absent from the template", () => {
    expect(missingMarkers("{{items}} only", ["items", "lines"])).toEqual(["lines"]);
  });

  it("the default quote-paste prompt carries both markers", () => {
    expect(missingMarkers(RFQ_QUOTE_PASTE_DEFAULT_PROMPT, ["items", "lines"])).toEqual([]);
  });
});
