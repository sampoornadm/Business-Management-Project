import { THEME_COLOR_KEYS, type ThemeColorKey } from "@bmp/types";

export interface ThemeColorVars {
  primary: string;
  primaryForeground: string;
  ring: string;
}

const LIGHT_FOREGROUND = "210 40% 98%";
const DARK_FOREGROUND = "222 47% 11%";

export const THEME_COLORS: Record<ThemeColorKey, { light: ThemeColorVars; dark: ThemeColorVars }> = {
  steel: {
    light: { primary: "216 65% 34%", primaryForeground: LIGHT_FOREGROUND, ring: "216 65% 34%" },
    dark: { primary: "216 65% 58%", primaryForeground: DARK_FOREGROUND, ring: "216 65% 58%" },
  },
  blue: {
    light: { primary: "221 70% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "221 70% 45%" },
    dark: { primary: "217 75% 60%", primaryForeground: DARK_FOREGROUND, ring: "217 75% 60%" },
  },
  green: {
    light: { primary: "152 55% 32%", primaryForeground: LIGHT_FOREGROUND, ring: "152 55% 32%" },
    dark: { primary: "150 55% 45%", primaryForeground: DARK_FOREGROUND, ring: "150 55% 45%" },
  },
  violet: {
    light: { primary: "262 55% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "262 55% 45%" },
    dark: { primary: "258 60% 62%", primaryForeground: DARK_FOREGROUND, ring: "258 60% 62%" },
  },
  amber: {
    light: { primary: "38 80% 38%", primaryForeground: LIGHT_FOREGROUND, ring: "38 80% 38%" },
    dark: { primary: "38 85% 55%", primaryForeground: DARK_FOREGROUND, ring: "38 85% 55%" },
  },
  rose: {
    light: { primary: "347 65% 42%", primaryForeground: LIGHT_FOREGROUND, ring: "347 65% 42%" },
    dark: { primary: "347 70% 60%", primaryForeground: DARK_FOREGROUND, ring: "347 70% 60%" },
  },
  teal: {
    light: { primary: "175 60% 30%", primaryForeground: LIGHT_FOREGROUND, ring: "175 60% 30%" },
    dark: { primary: "175 55% 45%", primaryForeground: DARK_FOREGROUND, ring: "175 55% 45%" },
  },
  slate: {
    light: { primary: "215 20% 35%", primaryForeground: LIGHT_FOREGROUND, ring: "215 20% 35%" },
    dark: { primary: "215 15% 60%", primaryForeground: DARK_FOREGROUND, ring: "215 15% 60%" },
  },
  indigo: {
    light: { primary: "243 60% 48%", primaryForeground: LIGHT_FOREGROUND, ring: "243 60% 48%" },
    dark: { primary: "240 65% 65%", primaryForeground: DARK_FOREGROUND, ring: "240 65% 65%" },
  },
  orange: {
    light: { primary: "22 80% 45%", primaryForeground: LIGHT_FOREGROUND, ring: "22 80% 45%" },
    dark: { primary: "24 85% 58%", primaryForeground: DARK_FOREGROUND, ring: "24 85% 58%" },
  },
};

export function getThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): ThemeColorVars {
  const entry = THEME_COLORS[key] ?? THEME_COLORS.steel;
  return entry[mode];
}

const CACHE_KEY = "bmp-theme-color-vars";

export function applyThemeColorVars(key: ThemeColorKey, mode: "light" | "dark"): void {
  const vars = getThemeColorVars(key, mode);
  const root = document.documentElement.style;
  root.setProperty("--primary", vars.primary);
  root.setProperty("--primary-foreground", vars.primaryForeground);
  root.setProperty("--ring", vars.ring);
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(vars));
}

export function readCachedThemeColorVars(): ThemeColorVars | null {
  const raw = window.localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThemeColorVars;
  } catch {
    return null;
  }
}

export { THEME_COLOR_KEYS };
export type { ThemeColorKey };
