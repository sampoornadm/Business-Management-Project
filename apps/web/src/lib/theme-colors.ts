import { THEME_COLOR_KEYS, type ThemeColorKey } from "@bmp/types";

export interface ThemeColorVars {
  primary: string;
  primaryForeground: string;
  ring: string;
  // A washed-out tint of `primary` for the dashboard header background — same hue, much lower
  // saturation/lightness (dark mode) or much higher lightness (light mode), so the active
  // business's color is recognizable at a glance without the header competing with page content.
  headerBg: string;
}

const LIGHT_FOREGROUND = "210 40% 98%";
const DARK_FOREGROUND = "222 47% 11%";

// Derives a header-background tint from a `primary` HSL triple ("H S% L%"): keeps the hue, scales
// saturation down (a wash at full saturation reads as a garish pastel, not a subtle tint), and
// pins lightness near the page background for each mode. Kept as one formula (rather than 10
// colors × 2 modes of hand-picked values) so every color's header tint stays visually consistent
// and there's nothing to keep in sync when a primary value changes.
function washed(primaryHsl: string, mode: "light" | "dark"): string {
  const [hue, saturationToken] = primaryHsl.split(" ");
  const saturation = Number(saturationToken!.replace("%", ""));
  const washedSaturation = Math.round(saturation * 0.55);
  const lightness = mode === "light" ? 94 : 15;
  return `${hue} ${washedSaturation}% ${lightness}%`;
}

export const THEME_COLORS: Record<ThemeColorKey, { light: ThemeColorVars; dark: ThemeColorVars }> = {
  steel: {
    light: {
      primary: "216 65% 34%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "216 65% 34%",
      headerBg: washed("216 65% 34%", "light"),
    },
    dark: {
      primary: "216 65% 58%",
      primaryForeground: DARK_FOREGROUND,
      ring: "216 65% 58%",
      headerBg: washed("216 65% 58%", "dark"),
    },
  },
  blue: {
    light: {
      primary: "221 70% 45%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "221 70% 45%",
      headerBg: washed("221 70% 45%", "light"),
    },
    dark: {
      primary: "217 75% 60%",
      primaryForeground: DARK_FOREGROUND,
      ring: "217 75% 60%",
      headerBg: washed("217 75% 60%", "dark"),
    },
  },
  green: {
    light: {
      primary: "152 55% 32%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "152 55% 32%",
      headerBg: washed("152 55% 32%", "light"),
    },
    dark: {
      primary: "150 55% 45%",
      primaryForeground: DARK_FOREGROUND,
      ring: "150 55% 45%",
      headerBg: washed("150 55% 45%", "dark"),
    },
  },
  violet: {
    light: {
      primary: "262 55% 45%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "262 55% 45%",
      headerBg: washed("262 55% 45%", "light"),
    },
    dark: {
      primary: "258 60% 62%",
      primaryForeground: DARK_FOREGROUND,
      ring: "258 60% 62%",
      headerBg: washed("258 60% 62%", "dark"),
    },
  },
  amber: {
    light: {
      primary: "38 80% 38%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "38 80% 38%",
      headerBg: washed("38 80% 38%", "light"),
    },
    dark: {
      primary: "38 85% 55%",
      primaryForeground: DARK_FOREGROUND,
      ring: "38 85% 55%",
      headerBg: washed("38 85% 55%", "dark"),
    },
  },
  rose: {
    light: {
      primary: "347 65% 42%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "347 65% 42%",
      headerBg: washed("347 65% 42%", "light"),
    },
    dark: {
      primary: "347 70% 60%",
      primaryForeground: DARK_FOREGROUND,
      ring: "347 70% 60%",
      headerBg: washed("347 70% 60%", "dark"),
    },
  },
  teal: {
    light: {
      primary: "175 60% 30%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "175 60% 30%",
      headerBg: washed("175 60% 30%", "light"),
    },
    dark: {
      primary: "175 55% 45%",
      primaryForeground: DARK_FOREGROUND,
      ring: "175 55% 45%",
      headerBg: washed("175 55% 45%", "dark"),
    },
  },
  slate: {
    light: {
      primary: "215 20% 35%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "215 20% 35%",
      headerBg: washed("215 20% 35%", "light"),
    },
    dark: {
      primary: "215 15% 60%",
      primaryForeground: DARK_FOREGROUND,
      ring: "215 15% 60%",
      headerBg: washed("215 15% 60%", "dark"),
    },
  },
  indigo: {
    light: {
      primary: "243 60% 48%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "243 60% 48%",
      headerBg: washed("243 60% 48%", "light"),
    },
    dark: {
      primary: "240 65% 65%",
      primaryForeground: DARK_FOREGROUND,
      ring: "240 65% 65%",
      headerBg: washed("240 65% 65%", "dark"),
    },
  },
  orange: {
    light: {
      primary: "22 80% 45%",
      primaryForeground: LIGHT_FOREGROUND,
      ring: "22 80% 45%",
      headerBg: washed("22 80% 45%", "light"),
    },
    dark: {
      primary: "24 85% 58%",
      primaryForeground: DARK_FOREGROUND,
      ring: "24 85% 58%",
      headerBg: washed("24 85% 58%", "dark"),
    },
  },
};

export function getThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): ThemeColorVars {
  const entry = THEME_COLORS[key] ?? THEME_COLORS.steel;
  return entry[mode];
}

// Also hardcoded as a raw string in the pre-hydration <script> in app/layout.tsx
// (that inline script can't import this const) — keep both in sync if renamed.
const CACHE_KEY = "bmp-theme-color-vars";

export function applyThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): void {
  const vars = getThemeColorVars(key, mode);
  const root = document.documentElement.style;
  root.setProperty("--primary", vars.primary);
  root.setProperty("--primary-foreground", vars.primaryForeground);
  root.setProperty("--ring", vars.ring);
  root.setProperty("--header-bg", vars.headerBg);
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(vars));
}

export { THEME_COLOR_KEYS };
export type { ThemeColorKey };
