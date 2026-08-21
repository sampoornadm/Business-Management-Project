// Shared semantic colors for recharts fills/strokes — mirrors the CSS custom
// properties badges use (see globals.css) so a chart and a badge for the same
// status always agree, instead of every bar defaulting to the brand color.
export const CHART_COLORS = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--secondary))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
} as const;
