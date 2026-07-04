/** Rounds to 2 decimal places, avoiding common floating-point artifacts (e.g. 1.005 -> 1). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
