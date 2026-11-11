import type {
  SubmissionChanges,
  SubmissionLineDiff,
  SubmissionLineField,
  TenderSubmissionLineDto,
} from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

/** What a submission freezes: its reference, its total and every leaf BOQ line. */
export interface SubmissionSnapshot {
  reference: string | null;
  totalAmount: number;
  lines: TenderSubmissionLineDto[];
}

const PRICING_FIELDS: SubmissionLineField[] = ["rate", "baseRate", "markupPercent", "vendor"];

/** Rupees with Indian digit grouping: formatInr(1240000, 0) → "₹12,40,000". */
export function formatInr(value: number, decimals: 0 | 2): string {
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}`;
}

function sameMoney(a: number | null, b: number | null): boolean {
  return a === null || b === null ? a === b : round2(a) === round2(b);
}

function changedFields(before: TenderSubmissionLineDto, after: TenderSubmissionLineDto): SubmissionLineField[] {
  const changed: SubmissionLineField[] = [];
  if (!sameMoney(before.rate, after.rate)) changed.push("rate");
  if (!sameMoney(before.baseRate, after.baseRate)) changed.push("baseRate");
  if (before.markupPercent !== after.markupPercent) changed.push("markupPercent");
  if (before.vendorId !== after.vendorId) changed.push("vendor");
  if (before.quantity !== after.quantity) changed.push("quantity");
  if (before.hsnCode !== after.hsnCode) changed.push("hsnCode");
  if (before.technicalDeviation !== after.technicalDeviation) changed.push("technicalDeviation");
  return changed;
}

/**
 * Pairs each current line with its previous self: by BOQ item id first, then — for lines a
 * re-uploaded BOQ version gave new ids — by exact description + unit, one-to-one in order.
 */
export function diffSubmissions(previous: SubmissionSnapshot, current: SubmissionSnapshot): SubmissionChanges {
  const unmatchedPrevious = [...previous.lines];
  const take = (predicate: (line: TenderSubmissionLineDto) => boolean) => {
    const index = unmatchedPrevious.findIndex(predicate);
    return index === -1 ? null : unmatchedPrevious.splice(index, 1)[0]!;
  };

  const pairs = new Map<TenderSubmissionLineDto, TenderSubmissionLineDto>();
  for (const line of current.lines) {
    const match = take((p) => p.boqItemId === line.boqItemId);
    if (match) pairs.set(line, match);
  }
  for (const line of current.lines) {
    if (pairs.has(line)) continue;
    const match = take((p) => p.description === line.description && p.unit === line.unit);
    if (match) pairs.set(line, match);
  }

  const lines: SubmissionLineDiff[] = [];
  const added: TenderSubmissionLineDto[] = [];
  for (const after of current.lines) {
    const before = pairs.get(after);
    if (!before) {
      added.push(after);
      continue;
    }
    const changed = changedFields(before, after);
    if (changed.length > 0) lines.push({ before, after, changed });
  }

  return {
    reference:
      previous.reference !== current.reference ? { before: previous.reference, after: current.reference } : null,
    total: sameMoney(previous.totalAmount, current.totalAmount)
      ? null
      : { before: previous.totalAmount, after: current.totalAmount },
    lines,
    added,
    removed: unmatchedPrevious,
  };
}

function hasChanges(changes: SubmissionChanges): boolean {
  return Boolean(
    changes.reference || changes.total || changes.lines.length || changes.added.length || changes.removed.length,
  );
}

const money = (value: number | null) => (value === null ? "no rate" : formatInr(value, 2));
const percent = (value: number | null) => (value === null ? "-" : `${value}%`);
const deviation = (value: string | null) => (value === null ? "none" : `"${value}"`);

function section(title: string, bullets: string[]): string[] {
  return bullets.length === 0 ? [] : [`${title} (${bullets.length}):`, ...bullets.map((b) => `• ${b}`)];
}

function rateBullet({ before, after, changed }: SubmissionLineDiff): string {
  let text = `${after.description} — ${money(before.rate)} → ${money(after.rate)}`;
  if (changed.includes("vendor")) {
    text += ` · ${before.vendorName ?? "no vendor"} → ${after.vendorName ?? "no vendor"}`;
  }
  if (before.markupPercent !== null || after.markupPercent !== null) {
    text += ` · markup ${percent(before.markupPercent)} → ${percent(after.markupPercent)}`;
  }
  return text;
}

/**
 * The plain-text change log stored with a submission and shown verbatim on the History tab and in
 * the Audit Log. `previous` is null for a tender's first submission.
 */
export function renderSubmissionSummary(
  number: number,
  current: SubmissionSnapshot,
  previous: { number: number; snapshot: SubmissionSnapshot; changes: SubmissionChanges } | null,
): string {
  const changes = previous?.changes ?? null;
  let header = `Submission #${number}`;
  if (current.reference !== null || changes?.reference) {
    header += ` · ref ${current.reference ?? "none"}`;
    if (changes?.reference) header += ` (was ${changes.reference.before ?? "none"})`;
  }
  if (!previous) {
    const count = current.lines.length;
    header += ` · ${count} ${count === 1 ? "item" : "items"}`;
  }
  header += ` · total ${formatInr(current.totalAmount, 0)}`;
  if (changes?.total) header += ` (was ${formatInr(changes.total.before, 0)})`;

  if (!previous || !changes) return header;
  if (!hasChanges(changes)) return `${header}\nNo changes since #${previous.number}`;

  const withField = (field: SubmissionLineField) => changes.lines.filter((l) => l.changed.includes(field));
  return [
    header,
    ...section(
      "Rates changed",
      changes.lines.filter((l) => l.changed.some((f) => PRICING_FIELDS.includes(f))).map(rateBullet),
    ),
    ...section(
      "HSN changed",
      withField("hsnCode").map((l) => `${l.after.description} — ${l.before.hsnCode ?? "none"} → ${l.after.hsnCode ?? "none"}`),
    ),
    ...section(
      "Technical deviation changed",
      withField("technicalDeviation").map(
        (l) => `${l.after.description} — ${deviation(l.before.technicalDeviation)} → ${deviation(l.after.technicalDeviation)}`,
      ),
    ),
    ...section(
      "Quantity changed",
      withField("quantity").map(
        (l) =>
          `${l.after.description} — ${l.before.quantity ?? "-"} → ${l.after.quantity ?? "-"}${l.after.unit ? ` ${l.after.unit}` : ""}`,
      ),
    ),
    ...section("Added", changes.added.map((l) => l.description)),
    ...section("Removed", changes.removed.map((l) => l.description)),
  ].join("\n");
}
