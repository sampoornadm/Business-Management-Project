export const THEME_COLOR_KEYS = [
  "steel",
  "blue",
  "green",
  "violet",
  "amber",
  "rose",
  "teal",
  "slate",
  "indigo",
  "orange",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
