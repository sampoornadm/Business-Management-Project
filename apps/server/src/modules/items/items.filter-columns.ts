import type { ItemFilterField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const ITEM_FILTER_COLUMNS: Record<ItemFilterField, FilterableColumnDescriptor> = {
  canonicalName: { type: "text", prismaPath: ["canonicalName"] },
  unit: { type: "text", prismaPath: ["unit"], nullable: true },
  // Filtered by categoryId (a real column on Item) even though the column displays the derived
  // categoryPath string — the frontend's enumOptions for this column are category ids labeled
  // with their path (see items/page.tsx), same "filter by id, display the derived label" idea as
  // TENDER_FILTER_COLUMNS.clientName, except items have a direct FK to filter on instead of a
  // name match.
  categoryPath: { type: "enum", prismaPath: ["categoryId"], nullable: true },
};
