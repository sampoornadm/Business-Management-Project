import { round2 } from "../../shared/utils/math.js";

import type { IBoqRepository } from "./boq.repository.js";

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

export interface ChargeLoadLine {
  id: string;
  quantity: number | null;
  rate: number | null;
  chargeLoad: number | null;
}

export interface ChargeLoadUpdate {
  id: string;
  rate: number;
  amount: number | null;
  chargeLoad: number | null;
}

/**
 * Spreads `total` (the tender's additional charges marked "add to item rates") over every line
 * that has both a quantity and a rate, in proportion to the line's amount before charges: each
 * rate becomes preRate × (1 + total/subtotal). `rate` on input already includes the line's old
 * `chargeLoad`, which is taken off first, so this is safe to re-run after any pricing write.
 * Lines with a rate but no quantity carry no share. Returns only the lines whose figures change.
 *
 * ponytail: per-unit share rounded to 2 dp, so Σ amounts can miss subtotal + total by up to
 * quantity × ₹0.005 per line; push the rounding remainder onto the largest line if that matters.
 */
export function distributeCharges(lines: ChargeLoadLine[], total: number): ChargeLoadUpdate[] {
  const preRate = (line: ChargeLoadLine) => round2((line.rate ?? 0) - (line.chargeLoad ?? 0));
  const priced = lines.filter((line) => line.rate !== null && line.quantity !== null);
  const subtotal = priced.reduce((sum, line) => sum + line.quantity! * preRate(line), 0);
  const factor = total > 0 && subtotal > 0 ? total / subtotal : 0;
  const pricedIds = new Set(priced.map((line) => line.id));

  const updates: ChargeLoadUpdate[] = [];
  for (const line of lines) {
    if (line.rate === null) continue;
    const base = preRate(line);
    const chargeLoad = pricedIds.has(line.id) && factor > 0 ? round2(base * factor) : null;
    if (chargeLoad === line.chargeLoad || (chargeLoad === null && !line.chargeLoad)) continue;
    const rate = round2(base + (chargeLoad ?? 0));
    updates.push({ id: line.id, rate, amount: line.quantity !== null ? round2(line.quantity * rate) : null, chargeLoad });
  }
  return updates;
}

type ChargeLoadRepository = Pick<
  IBoqRepository,
  "findCurrentBoq" | "findItemsByBoqId" | "findTenderCharges" | "applyChargeLoads"
>;

/**
 * Re-spreads the tender's "add to item rates" charges over its current BOQ. Call after every write
 * that changes a rate, quantity, the item set or the charges themselves (rate writes reset the
 * line's chargeLoad to null first, meaning "this rate is before charges").
 */
export async function rebalanceChargeLoads(
  repository: ChargeLoadRepository,
  tenderId: string,
  businessId: string,
): Promise<void> {
  const boq = await repository.findCurrentBoq(tenderId, businessId);
  if (!boq) return;
  const [items, charges] = await Promise.all([
    repository.findItemsByBoqId(boq.id),
    repository.findTenderCharges(tenderId),
  ]);
  const total = charges.filter((charge) => charge.addToRates).reduce((sum, charge) => sum + charge.amount, 0);
  await repository.applyChargeLoads(distributeCharges(items, total));
}
