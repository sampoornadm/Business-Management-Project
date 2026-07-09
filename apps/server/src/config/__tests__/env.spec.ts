import { describe, expect, it } from "vitest";

import { booleanEnv } from "../env.js";

describe("booleanEnv", () => {
  it("parses the literal string \"true\" as true", () => {
    expect(booleanEnv("false").parse("true")).toBe(true);
  });

  it("parses the literal string \"false\" as false", () => {
    // This is the exact case z.coerce.boolean() gets wrong: Boolean("false")
    // is true in plain JS, which would make an env flag impossible to turn off.
    expect(booleanEnv("false").parse("false")).toBe(false);
    expect(booleanEnv("true").parse("false")).toBe(false);
  });

  it("falls back to the given default when unset", () => {
    expect(booleanEnv("false").parse(undefined)).toBe(false);
    expect(booleanEnv("true").parse(undefined)).toBe(true);
  });
});
