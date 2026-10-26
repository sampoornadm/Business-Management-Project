/** Distinct non-empty HSN codes in first-occurrence order, comma-joined; null when none. */
export function joinHsnCodes(items: ReadonlyArray<{ hsnCode: string | null }>): string | null {
  const codes: string[] = [];
  for (const { hsnCode } of items) {
    const code = hsnCode?.trim();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes.length > 0 ? codes.join(", ") : null;
}

/**
 * Consignment weight as "<n> Kg". `text` is null (and `missing` says how many items blocked it)
 * as soon as any item lacks a quantity or unit weight — a partial sum would read as a real weight.
 */
export function consignmentWeight(
  items: ReadonlyArray<{ quantity: number | null; unitWeightKg: number | null }>,
): { text: string | null; missing: number } {
  let total = 0;
  let missing = 0;
  for (const { quantity, unitWeightKg } of items) {
    if (quantity === null || unitWeightKg === null) missing += 1;
    else total += quantity * unitWeightKg;
  }
  if (missing > 0 || items.length === 0) return { text: null, missing };
  return { text: `${Number(total.toFixed(3))} Kg`, missing: 0 };
}

function stateCode(gstin: string): string {
  const code = gstin.trim().slice(0, 2);
  if (!/^\d{2}$/.test(code)) throw new Error(`GSTIN "${gstin}" has no state code`);
  return code;
}

/** Same state (GSTIN prefix) means intra-state CGST + SGST; otherwise a single IGST. */
export function splitGst(
  gstRate: number,
  supplierGstin: string,
  billingGstin: string,
): { cgstPct: number; sgstPct: number; igstPct: number } {
  if (stateCode(supplierGstin) === stateCode(billingGstin)) {
    return { cgstPct: gstRate / 2, sgstPct: gstRate / 2, igstPct: 0 };
  }
  return { cgstPct: 0, sgstPct: 0, igstPct: gstRate };
}
