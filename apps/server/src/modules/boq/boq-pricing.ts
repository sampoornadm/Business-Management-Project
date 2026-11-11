import { round2 } from "../../shared/utils/math.js";

/** Quoted rate for a line priced from a vendor base rate: base × (1 + markup%), 2 dp. */
export function rateFromMarkup(baseRate: number, markupPercent: number): number {
  return round2(baseRate * (1 + markupPercent / 100));
}

/**
 * Markup implied by a hand-typed rate on a line that has a base rate. A base rate of 0 has no
 * meaningful markup (division by zero), so the caller's current markup is kept instead.
 */
export function markupFromRate(baseRate: number, rate: number, fallback: number | null): number | null {
  if (baseRate === 0) return fallback;
  return round2((rate / baseRate - 1) * 100);
}
