import type { ExtractedTenderItem } from "@bmp/types";

import { TABLE_CELL_SEPARATOR } from "./tender-extraction.parser.js";

// Longest-first so "pcs" wins over "pc" and "mtrs" over "mtr".
const UNITS = [
  "numbers", "number", "packets", "packet", "tonnes", "tonne", "metres", "metre", "meters", "meter",
  "litres", "litre", "sheets", "sheet", "pairs", "pair", "boxes", "rolls", "roll", "coils", "coil",
  "units", "unit", "sets", "set", "bags", "bag", "pkts", "pkt", "tons", "ton", "mtrs", "mtr",
  "ltrs", "ltr", "kgs", "kg", "nos", "no", "pcs", "pc", "box", "sqm", "sqft", "cum", "rmt", "lots",
  "lot", "job", "each", "ea", "gms", "gm",
].join("|");

/** A cell like "2pcs.", "100pcs. Each", "3mtr.", "12 Nos" — quantity and unit fused together. */
const QUANTITY_CELL = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b\\.?`, "i");
const PLAIN_NUMBER = /^\d+(?:[.,]\d+)?$/;
const SERIAL_NUMBER = /^\d{1,3}[.)]?$/;

/**
 * A free-text line that ends in its own quantity — "Mouse _ Logitech M90 Wired Mouse – 3 pcs".
 * Anchored to end-of-line and restricted to the unit vocabulary above so ordinary terms lines
 * ("Payment Terms- Net45.", "Warranty : 24months after complete the work") cannot match.
 */
const TRAILING_QUANTITY = new RegExp(
  `^(.{3,}?)\\s*[\\u2013\\u2014-]?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b\\.?$`,
  "i",
);

const HEADER_PATTERNS = {
  itemCode: /\b(item|material|part|product)\s*(code|no\.?|number|id)\b|^code$/i,
  // Several columns can qualify at once (a short "Label" plus a long spec in "Comment"); every
  // match is kept and joined, because ExtractedTenderItem has one description field and the spec
  // text is what actually prices the item.
  description: /description|label|particular|item\s*name|material|specification|comment/i,
  quantity: /^qty\b|\bquantity\b|^qty$/i,
  // Deliberately anchored: an unanchored /unit/ also matches "Unit Price (in bid currency)",
  // which is a money column, not a UoM column.
  unit: /^(uom|units?)$/i,
} as const;

type Field = keyof typeof HEADER_PATTERNS;

function toNumber(text: string): number | undefined {
  // Guarded against "": Number("") is 0, which would silently turn an empty quantity cell into a
  // real zero quantity.
  if (!/\d/.test(text)) return undefined;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

/** Joins several description columns, dropping duplicates and values already contained in another. */
function joinDescriptions(values: string[]): string {
  const unique: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text) continue;
    if (!unique.some((kept) => kept.toLowerCase() === text.toLowerCase())) unique.push(text);
  }
  return unique
    .filter(
      (value, index) =>
        !unique.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            other.length > value.length &&
            other.toLowerCase().includes(value.toLowerCase()),
        ),
    )
    .join(" — ");
}

function splitRow(line: string): string[] {
  return line.split(TABLE_CELL_SEPARATOR).map((cell) => cell.trim());
}

interface HeaderMapping {
  itemCode?: number;
  description: number[];
  quantity?: number;
  unit?: number;
}

/** Column indexes per field, or undefined when this row is not a header row. */
function mapHeaderRow(cells: string[]): HeaderMapping | undefined {
  const single: Partial<Record<Exclude<Field, "description">, number>> = {};
  const description: number[] = [];
  cells.forEach((cell, index) => {
    if (!cell) return;
    if (HEADER_PATTERNS.description.test(cell)) description.push(index);
    for (const field of ["itemCode", "quantity", "unit"] as const) {
      if (single[field] === undefined && HEADER_PATTERNS[field].test(cell)) single[field] = index;
    }
  });
  if (description.length === 0) return undefined;
  if (single.quantity === undefined && single.unit === undefined) return undefined;
  return { ...single, description };
}

function fromMappedRow(cells: string[], mapping: HeaderMapping): ExtractedTenderItem | undefined {
  const at = (index: number | undefined): string => (index === undefined ? "" : (cells[index] ?? ""));
  const description = joinDescriptions(mapping.description.map((index) => at(index)));
  if (!description) return undefined;

  const quantityCell = at(mapping.quantity);
  const fused = quantityCell.match(QUANTITY_CELL);

  return {
    itemCode: at(mapping.itemCode) || undefined,
    description,
    quantity: PLAIN_NUMBER.test(quantityCell) ? toNumber(quantityCell) : toNumber(fused?.[1] ?? ""),
    unit: at(mapping.unit) || fused?.[2] || undefined,
  };
}

/**
 * For a table with no header row at all — the common "TnC" layout, where the item grid is just
 * `Sl | Description | Machine | 2pcs. | <photo>`. A quantity cell is REQUIRED: without it there is
 * nothing distinguishing an item row from a letterhead or signature-block table, and inventing
 * items out of layout tables is worse than returning none.
 */
function fromUnlabelledRow(cells: string[]): ExtractedTenderItem | undefined {
  const values = cells.filter((cell) => cell.length > 0);
  if (values.length < 2) return undefined;
  if (SERIAL_NUMBER.test(values[0]!)) values.shift();

  // Last match, not first: "12pcs." sits to the right of a description that may itself contain a
  // measurement ("...wire quantity-120pcs. wire thickness-2.5mm").
  let quantityIndex = -1;
  for (let index = values.length - 1; index >= 0; index--) {
    if (QUANTITY_CELL.test(values[index]!)) {
      quantityIndex = index;
      break;
    }
  }
  if (quantityIndex === -1) return undefined;

  const [, quantity, unit] = values[quantityIndex]!.match(QUANTITY_CELL)!;
  const description = values
    .filter((_, index) => index !== quantityIndex)
    .filter((cell) => !PLAIN_NUMBER.test(cell))
    .join(" — ");
  if (!description) return undefined;

  return { description, quantity: toNumber(quantity!), unit: unit!.toLowerCase() };
}

/**
 * Generic item extraction for the non-SAIL document formats — Word "TnC" sheets (a terms block
 * followed by an item table, or a plain bulleted item list) and supplier quotation-response
 * workbooks. Runs only when the SAIL/IISCO parser (tender-item.parser.ts) finds nothing, and only
 * against DOCX/XLSX text, which arrives one-row-per-line with real cell separators — a PDF's
 * `-layout` text has no reliable cell boundary, so guessing columns from whitespace there would
 * manufacture junk items.
 *
 * Deterministic on purpose, for the same reason the SAIL parser is: quantities drive the BOQ and
 * ultimately the quoted price, and a small local model transcribing a long item list is exactly
 * where a silent off-by-one digit comes from.
 */
export function parseTabularItems(text: string): ExtractedTenderItem[] {
  // Deliberately not trimmed here: a leading empty cell is significant (trimming would eat the
  // leading tabs and shift every column left relative to the header row). splitRow trims per cell.
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  const rows = lines.filter((line) => line.includes(TABLE_CELL_SEPARATOR)).map(splitRow);

  if (rows.length > 0) {
    const headerIndex = rows.findIndex((cells) => mapHeaderRow(cells) !== undefined);
    const items: ExtractedTenderItem[] = [];

    if (headerIndex !== -1) {
      const mapping = mapHeaderRow(rows[headerIndex]!)!;
      for (const cells of rows.slice(headerIndex + 1)) {
        const item = fromMappedRow(cells, mapping);
        if (item) items.push(item);
      }
    } else {
      for (const cells of rows) {
        const item = fromUnlabelledRow(cells);
        if (item) items.push(item);
      }
    }
    if (items.length > 0) return items;
  }

  // No table at all: a Word document that just lists its items as paragraphs.
  return lines.flatMap((line) => {
    const match = line.trim().match(TRAILING_QUANTITY);
    if (!match) return [];
    const [, description, quantity, unit] = match;
    return [{ description: description!.trim(), quantity: toNumber(quantity!), unit: unit!.toLowerCase() }];
  });
}
