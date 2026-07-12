import { describe, expect, it } from "vitest";

import { getThemeColorVars, THEME_COLORS } from "./theme-colors";

describe("getThemeColorVars", () => {
  it("returns the light variant for a known key", () => {
    expect(getThemeColorVars("blue", "light")).toEqual(THEME_COLORS.blue.light);
  });

  it("returns the dark variant for a known key", () => {
    expect(getThemeColorVars("blue", "dark")).toEqual(THEME_COLORS.blue.dark);
  });

  it("falls back to steel for an unknown key", () => {
    expect(getThemeColorVars("not-a-real-key" as never, "light")).toEqual(THEME_COLORS.steel.light);
  });
});
