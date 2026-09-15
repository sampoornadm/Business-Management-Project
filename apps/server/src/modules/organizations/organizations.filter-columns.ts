import type { Prisma } from "@bmp/database";
import type { OrganizationFilterField, OrganizationSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const ORGANIZATION_FILTER_COLUMNS: Record<OrganizationFilterField, FilterableColumnDescriptor> = {
  name: { type: "text", prismaPath: ["name"] },
  type: { type: "enum", prismaPath: ["type"] },
  city: { type: "text", prismaPath: ["city"], nullable: true },
  state: { type: "text", prismaPath: ["state"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.OrganizationOrderByWithRelationInput;

// `tenderCount` is sortable but intentionally absent from ORGANIZATION_FILTER_COLUMNS above —
// Prisma supports `orderBy` on a relation's `_count` but has no `where` filter for it.
export const ORGANIZATION_SORT_COLUMNS: Record<OrganizationSortField, OrderByBuilder> = {
  name: (dir) => ({ name: dir }),
  type: (dir) => ({ type: dir }),
  city: (dir) => ({ city: dir }),
  state: (dir) => ({ state: dir }),
  tenderCount: (dir) => ({ tenders: { _count: dir } }),
};
