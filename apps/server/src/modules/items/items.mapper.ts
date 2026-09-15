import type { ItemDetailDto, ItemListEntryDto, ItemPriceHistoryDto, ItemSortField } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";
import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { ItemQuoteRow, ItemRow } from "./items.repository.js";

export interface ItemAgg {
  quoteCount: number;
  vendorCount: number;
  minRate: number;
  maxRate: number;
  avgRate: number;
  lastQuotedAt: Date;
}

export function aggregateQuotes(rows: ItemQuoteRow[]): Map<string, ItemAgg> {
  const acc = new Map<
    string,
    { count: number; sum: number; min: number; max: number; vendors: Set<string>; last: Date }
  >();

  for (const r of rows) {
    const a = acc.get(r.itemId);
    if (!a) {
      acc.set(r.itemId, { count: 1, sum: r.rate, min: r.rate, max: r.rate, vendors: new Set([r.vendorId]), last: r.quotedAt });
    } else {
      a.count += 1;
      a.sum += r.rate;
      a.min = Math.min(a.min, r.rate);
      a.max = Math.max(a.max, r.rate);
      a.vendors.add(r.vendorId);
      if (r.quotedAt > a.last) a.last = r.quotedAt;
    }
  }

  const out = new Map<string, ItemAgg>();
  for (const [id, a] of acc) {
    out.set(id, {
      quoteCount: a.count,
      vendorCount: a.vendors.size,
      minRate: a.min,
      maxRate: a.max,
      avgRate: a.sum / a.count,
      lastQuotedAt: a.last,
    });
  }
  return out;
}

export function toItemListEntryDto(
  item: ItemRow,
  agg: ItemAgg | undefined,
  categoryPath: string | null,
): ItemListEntryDto {
  return {
    id: item.id,
    canonicalName: item.canonicalName,
    unit: item.unit,
    categoryId: item.categoryId,
    categoryPath,
    confirmed: item.categoryConfirmed,
    aiConfidence: item.aiConfidence,
    needsReview: item.needsReview,
    quoteCount: agg?.quoteCount ?? 0,
    vendorCount: agg?.vendorCount ?? 0,
    minRate: agg?.minRate ?? null,
    maxRate: agg?.maxRate ?? null,
    avgRate: agg ? round2(agg.avgRate) : null,
    lastQuotedAt: agg ? agg.lastQuotedAt.toISOString() : null,
  };
}

export function toItemDetailDto(
  item: ItemRow,
  entries: ItemPriceHistoryDto[],
  categoryPath: string | null,
): ItemDetailDto {
  return {
    id: item.id,
    canonicalName: item.canonicalName,
    unit: item.unit,
    categoryId: item.categoryId,
    categoryPath,
    confirmed: item.categoryConfirmed,
    aiConfidence: item.aiConfidence,
    needsReview: item.needsReview,
    entries,
  };
}

/** In-memory sort so aggregate columns (rate range, quote count, last quoted) are sortable too. */
export function sortItemEntries(
  entries: ItemListEntryDto[],
  sortBy: ItemSortField | undefined,
  dir: "asc" | "desc",
): ItemListEntryDto[] {
  const field = sortBy ?? "canonicalName";
  const mul = dir === "desc" ? -1 : 1;

  const valueOf = (e: ItemListEntryDto): string | number | null => {
    switch (field) {
      case "canonicalName":
        return e.canonicalName;
      case "categoryPath":
        return e.categoryPath;
      case "unit":
        return e.unit;
      case "quoteCount":
        return e.quoteCount;
      case "minRate":
        return e.minRate;
      case "maxRate":
        return e.maxRate;
      case "avgRate":
        return e.avgRate;
      case "lastQuotedAt":
        return e.lastQuotedAt;
    }
  };

  return [...entries].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    // Nulls (unpriced / unclassified) always sort last, regardless of direction.
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * mul;
    return (av < bv ? -1 : av > bv ? 1 : 0) * mul;
  });
}

// Keep this in exact sync with apps/web/src/components/items/item-column-registry.tsx's
// ITEM_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const ITEM_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "canonicalName", header: "Item" },
  { key: "categoryPath", header: "Category" },
  { key: "unit", header: "Unit" },
  { key: "quoteCount", header: "Quotes" },
  { key: "vendorCount", header: "Vendors" },
  { key: "minRate", header: "Rate Range" },
  { key: "avgRate", header: "Avg Rate" },
  { key: "lastQuotedAt", header: "Last Quoted" },
];

function itemExportRow(entry: ItemListEntryDto): Record<string, string | number> {
  return {
    canonicalName: entry.canonicalName,
    categoryPath: entry.categoryPath ?? "",
    unit: entry.unit ?? "",
    quoteCount: entry.quoteCount,
    vendorCount: entry.vendorCount,
    minRate:
      entry.minRate === null || entry.maxRate === null
        ? ""
        : entry.minRate === entry.maxRate
          ? entry.minRate
          : `${entry.minRate}-${entry.maxRate}`,
    avgRate: entry.avgRate ?? "",
    lastQuotedAt: entry.lastQuotedAt ? entry.lastQuotedAt.slice(0, 10) : "",
  };
}

export function buildItemExportTable(entries: ItemListEntryDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(ITEM_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = entries.map((entry) => {
    const fullRow = itemExportRow(entry);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Items", columns, rows };
}

export const ITEM_EXPORT_COLUMN_KEYS = ITEM_EXPORT_COLUMNS.map((column) => column.key);
