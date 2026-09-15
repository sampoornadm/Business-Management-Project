import type { Prisma } from "@bmp/database";
import type { BillFilterField, BillSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const BILL_FILTER_COLUMNS: Record<BillFilterField, FilterableColumnDescriptor> = {
  billNumber: { type: "text", prismaPath: ["billNumber"] },
  tenderTitle: { type: "text", prismaPath: ["tender", "title"] },
  // Type "enum" (not "text") so the frontend's "is"/"is_not"/"any_of" operators are all
  // permitted here — the filter builder offers clients as a pick-list (derived from clients
  // currently in view, see apps/web bills page), not free text, but still matches by exact
  // name at this prismaPath (Bill has no direct client relation — it's reached through
  // tender.client), mirroring tenders.filter-columns.ts's clientName.
  clientName: { type: "enum", prismaPath: ["tender", "client", "name"] },
  billDate: { type: "date", prismaPath: ["billDate"] },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.BillOrderByWithRelationInput;

// itemCount is sortable but intentionally absent from BILL_FILTER_COLUMNS above — Prisma
// supports `orderBy` on a relation's `_count` but has no `where` filter for it (mirrors
// tenders.filter-columns.ts's assigneeCount). `total` (sum of quantity × rate across BillItem
// rows, computed in bills.mapper.ts on read) is neither sortable nor filterable at all — it's
// not a column or a Prisma-orderable aggregate.
export const BILL_SORT_COLUMNS: Record<BillSortField, OrderByBuilder> = {
  billNumber: (dir) => ({ billNumber: dir }),
  tenderTitle: (dir) => ({ tender: { title: dir } }),
  clientName: (dir) => ({ tender: { client: { name: dir } } }),
  billDate: (dir) => ({ billDate: dir }),
  itemCount: (dir) => ({ items: { _count: dir } }),
  createdAt: (dir) => ({ createdAt: dir }),
};
