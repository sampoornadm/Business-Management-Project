import { describe, expect, it } from "vitest";

import { getThemeColorVars, THEME_COLOR_KEYS, THEME_COLORS } from "./theme-colors";

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

describe("headerBg (washed-out tint for the dashboard header)", () => {
  it("keeps the same hue as primary but pins lightness near-white in light mode", () => {
    const { primary, headerBg } = THEME_COLORS.blue.light;
    const primaryHue = primary.split(" ")[0];
    const [headerHue, headerSaturation, headerLightness] = headerBg.split(" ");

    expect(headerHue).toBe(primaryHue);
    expect(headerLightness).toBe("94%");
    // Washed, not a full-saturation pastel — scaled down from primary's own saturation.
    expect(Number(headerSaturation!.replace("%", ""))).toBeLessThan(Number(primary.split(" ")[1]!.replace("%", "")));
  });

  it("keeps the same hue as primary but pins lightness near-black in dark mode", () => {
    const { primary, headerBg } = THEME_COLORS.blue.dark;
    const primaryHue = primary.split(" ")[0];
    const [headerHue, , headerLightness] = headerBg.split(" ");

    expect(headerHue).toBe(primaryHue);
    expect(headerLightness).toBe("15%");
  });

  it("gives every theme color a distinct header hue, so businesses stay visually distinguishable", () => {
    const hues = THEME_COLOR_KEYS.map((key) => THEME_COLORS[key].light.headerBg.split(" ")[0]);
    expect(new Set(hues).size).toBe(THEME_COLOR_KEYS.length);
  });
});
