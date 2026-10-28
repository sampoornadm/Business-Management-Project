import { formatItemCodeForDisplay } from "@bmp/types";
import { describe, expect, it } from "vitest";

import {
  deriveFamilyKey,
  formatItemCode,
  headingPrefix,
  parseItemCode,
} from "../item-code.js";

describe("item-code", () => {
  it("puts sizes of the same item in one family", () => {
    expect(deriveFamilyKey("XLPE Cable 4C x16")).toBe(deriveFamilyKey("XLPE  cable 4C x 25"));
    expect(deriveFamilyKey("XLPE Cable 4C x16")).not.toBe(deriveFamilyKey("PVC Cable 4C x16"));
  });

  it("builds an 11-digit numeric code and parses it back", () => {
    const code = formatItemCode("7318", 42, 1);
    expect(code).toBe("73180042001");
    expect(parseItemCode(code)).toEqual({ prefix: "7318", family: 42, variant: 1 });
    expect(formatItemCodeForDisplay(code)).toBe("73 18 0042 001");
  });

  it("rejects malformed codes and falls back to 0000 for an unknown heading", () => {
    expect(parseItemCode("12345")).toBeNull();
    expect(parseItemCode("7318004200a")).toBeNull();
    expect(headingPrefix(null)).toBe("0000");
    expect(headingPrefix("73")).toBe("0000");
    expect(headingPrefix("85443000")).toBe("8544");
  });
});
