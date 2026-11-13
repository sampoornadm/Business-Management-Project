import type { TrendDirection } from "@bmp/types";

export interface RatePoint {
  at: Date;
  rate: number;
}

export type { TrendDirection };

export interface RateForecast {
  lastRate: number;
  /** Null until there are at least two quotes to draw a line through. */
  predictedRate: number | null;
  direction: TrendDirection | null;
  points: number;
}

const DAY_MS = 86_400_000;
/** A predicted move smaller than this share of the last rate is reported as flat. */
const FLAT_BAND = 0.01;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Where one bidder's rate for one item is heading, from the rates they quoted before.
 * Returns null when they have never quoted it.
 */
export function forecastRate(points: RatePoint[], asOf: Date): RateForecast | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const last = sorted[sorted.length - 1]!;
  if (sorted.length < 2) return { lastRate: last.rate, predictedRate: null, direction: null, points: 1 };

  // ponytail: naive linear trend with a one-step clamp; revisit once real history exists
  // (seasonality, quantity effects, raw-material indices are all ignored here).
  const origin = sorted[0]!.at.getTime();
  const xs = sorted.map((point) => (point.at.getTime() - origin) / DAY_MS);
  const ys = sorted.map((point) => point.rate);
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  const spread = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  // Every quote on the same day: there is no slope to speak of, so fall back to their average.
  const slope = spread === 0 ? 0 : xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i]! - meanY), 0) / spread;
  const fitted = meanY + slope * ((asOf.getTime() - origin) / DAY_MS - meanX);

  // One outlier or a long gap must not run away: never move further than the last observed step.
  const step = Math.abs(last.rate - sorted[sorted.length - 2]!.rate);
  const clamped = Math.min(last.rate + step, Math.max(last.rate - step, fitted));
  const predictedRate = round2(Math.max(0, clamped));

  const change = predictedRate - last.rate;
  const direction: TrendDirection =
    Math.abs(change) <= Math.abs(last.rate) * FLAT_BAND ? "FLAT" : change > 0 ? "RISING" : "FALLING";
  return { lastRate: last.rate, predictedRate, direction, points: sorted.length };
}
