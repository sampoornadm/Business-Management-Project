import type { Prisma } from "@bmp/database";
import type { RfqFilterField, RfqSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const RFQ_FILTER_COLUMNS: Record<RfqFilterField, FilterableColumnDescriptor> = {
  title: { type: "text", prismaPath: ["title"] },
  status: { type: "enum", prismaPath: ["status"] },
  dueDate: { type: "date", prismaPath: ["dueDate"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.RfqOrderByWithRelationInput;

// itemCount/vendorCount are sortable but intentionally absent from RFQ_FILTER_COLUMNS above —
// Prisma supports `orderBy` on a relation's `_count` but has no `where` filter for it (mirrors
// tenders.filter-columns.ts's assigneeCount).
export const RFQ_SORT_COLUMNS: Record<RfqSortField, OrderByBuilder> = {
  title: (dir) => ({ title: dir }),
  status: (dir) => ({ status: dir }),
  dueDate: (dir) => ({ dueDate: dir }),
  itemCount: (dir) => ({ items: { _count: dir } }),
  vendorCount: (dir) => ({ vendorInvites: { _count: dir } }),
  createdAt: (dir) => ({ createdAt: dir }),
};
