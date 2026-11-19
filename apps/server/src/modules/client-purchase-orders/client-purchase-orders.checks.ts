import type { ClientPoItemFlag, UnorderedBoqItemDto } from "@bmp/types";

/** A line of the tender's current BOQ, as the checks need it. */
export interface BoqLine {
  id: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
}

export interface PoLine {
  boqItemId: string | null;
  unit: string | null;
  quantity: number;
  rate: number;
}

const RATE_TOLERANCE = 0.005;

// Spellings of the same unit seen across client documents and our BOQs.
const UNIT_ALIASES: Record<string, string> = {
  no: "no", nos: "no", number: "no", numbers: "no", each: "no", ea: "no", pc: "no", pcs: "no",
  piece: "no", pieces: "no", unit: "no", units: "no",
  mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m", rmt: "m", m: "m",
  kg: "kg", kgs: "kg",
  set: "set", sets: "set",
  ltr: "l", ltrs: "l", litre: "l", litres: "l", l: "l",
};

function normalizeUnit(unit: string): string {
  const key = unit.toLowerCase().replace(/[^a-z]/g, "");
  return UNIT_ALIASES[key] ?? key;
}

/** Total quantity ordered per BOQ line across every PO line given. */
export function orderedQuantityByBoqItem(lines: PoLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!line.boqItemId) continue;
    totals.set(line.boqItemId, (totals.get(line.boqItemId) ?? 0) + line.quantity);
  }
  return totals;
}

/**
 * Flags one PO line against our BOQ. `orderedTotal` is how much of the same BOQ line all the
 * project's POs order together, so two split POs that together exceed the BOQ both get flagged.
 */
export function flagPoLine(line: PoLine, boqLine: BoqLine | undefined, orderedTotal: number): ClientPoItemFlag[] {
  if (!boqLine) return ["NOT_IN_BOQ"];
  const flags: ClientPoItemFlag[] = [];
  if (boqLine.rate !== null && Math.abs(boqLine.rate - line.rate) > RATE_TOLERANCE) flags.push("RATE_MISMATCH");
  if (boqLine.quantity !== null && orderedTotal > boqLine.quantity + RATE_TOLERANCE) flags.push("QTY_ABOVE_BOQ");
  if (line.unit && boqLine.unit && normalizeUnit(line.unit) !== normalizeUnit(boqLine.unit)) flags.push("UNIT_MISMATCH");
  return flags;
}

/**
 * Lines we expected the client to order but no PO does. Expected = the lines won on an
 * Individual-evaluation tender when there are any, else every priced leaf line of the BOQ.
 */
export function unorderedLines(
  expected: BoqLine[],
  orderedBoqItemIds: Set<string>,
): UnorderedBoqItemDto[] {
  return expected
    .filter((line) => !orderedBoqItemIds.has(line.id))
    .map((line) => ({
      boqItemId: line.id,
      itemCode: line.itemCode,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      rate: line.rate,
    }));
}

const normalizeCode = (code: string) => code.replace(/\D/g, "");
const normalizeText = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Finds the BOQ line an extracted PO line orders: same item code, else same description.
 * ponytail: exact matching only; a reworded description stays unlinked and the user picks the
 * line in the form. Add fuzzy matching if real POs show that happens often.
 */
export function matchBoqLine(
  extracted: { itemCode?: string | null; description: string },
  boqLines: BoqLine[],
): BoqLine | undefined {
  const code = extracted.itemCode ? normalizeCode(extracted.itemCode) : "";
  if (code) {
    const byCode = boqLines.find((line) => line.itemCode && normalizeCode(line.itemCode) === code);
    if (byCode) return byCode;
  }
  const text = normalizeText(extracted.description);
  return text ? boqLines.find((line) => normalizeText(line.description) === text) : undefined;
}
