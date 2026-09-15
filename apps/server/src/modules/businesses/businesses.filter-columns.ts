import type { Prisma } from "@bmp/database";
import type { BusinessFilterField, BusinessSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const BUSINESS_FILTER_COLUMNS: Record<BusinessFilterField, FilterableColumnDescriptor> = {
  name: { type: "text", prismaPath: ["name"] },
  code: { type: "text", prismaPath: ["code"] },
  city: { type: "text", prismaPath: ["city"], nullable: true },
  state: { type: "text", prismaPath: ["state"], nullable: true },
  gstNumber: { type: "text", prismaPath: ["gstNumber"], nullable: true },
  panNumber: { type: "text", prismaPath: ["panNumber"], nullable: true },
  msmeCategory: { type: "enum", prismaPath: ["msmeCategory"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.BusinessOrderByWithRelationInput;

// `tenderCount` is sortable but intentionally absent from BUSINESS_FILTER_COLUMNS above — Prisma
// supports `orderBy` on a relation's `_count` but has no `where` filter for it (same reasoning as
// tenders' assigneeCount).
export const BUSINESS_SORT_COLUMNS: Record<BusinessSortField, OrderByBuilder> = {
  name: (dir) => ({ name: dir }),
  code: (dir) => ({ code: dir }),
  isActive: (dir) => ({ isActive: dir }),
  tenderCount: (dir) => ({ tenders: { _count: dir } }),
  createdAt: (dir) => ({ createdAt: dir }),
};
