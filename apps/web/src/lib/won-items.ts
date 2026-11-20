import type { BoqItemDto, TenderWonItemDto } from "@bmp/types";

/** The priceable lines of a BOQ tree: everything that is not a category header over other lines. */
export function boqLeaves(items: BoqItemDto[]): BoqItemDto[] {
  return items.flatMap((item) => (item.children.length > 0 ? boqLeaves(item.children) : [item]));
}

/**
 * Ids of the current BOQ's lines that a Won result recorded as won. The result keeps a snapshot, so
 * a line is matched by its id first, then (for a BOQ that was re-uploaded since) by item code, then
 * by description.
 */
export function wonLineIds(items: BoqItemDto[], won: TenderWonItemDto[]): Set<string> {
  if (won.length === 0) return new Set();
  const hits = boqLeaves(items).filter((item) =>
    won.some(
      (w) =>
        w.boqItemId === item.id ||
        (w.itemCode !== null && w.itemCode === item.itemCode) ||
        w.description === item.description,
    ),
  );
  return new Set(hits.map((item) => item.id));
}
