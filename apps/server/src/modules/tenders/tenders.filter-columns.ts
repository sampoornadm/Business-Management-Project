import type { Prisma } from "@bmp/database";
import type { TenderFilterField, TenderSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const TENDER_FILTER_COLUMNS: Record<TenderFilterField, FilterableColumnDescriptor> = {
  tenderNumber: { type: "text", prismaPath: ["tenderNumber"] },
  title: { type: "text", prismaPath: ["title"] },
  // Type "enum" (not "text") so the frontend's "is"/"is_not"/"any_of" operators are all
  // permitted here — the filter builder offers clients as a pick-list (derived from clients
  // currently in view, see apps/web tenders page), not free text, but still matches by exact
  // name at this prismaPath (no client-id relation involved), same as before.
  clientName: { type: "enum", prismaPath: ["client", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  priority: { type: "enum", prismaPath: ["priority"] },
  department: { type: "text", prismaPath: ["department"], nullable: true },
  submissionDate: { type: "date", prismaPath: ["submissionDate"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.TenderOrderByWithRelationInput;

// `assigneeCount` is sortable but intentionally absent from TENDER_FILTER_COLUMNS above — Prisma
// supports `orderBy` on a relation's `_count` but has no `where` filter for it.
export const TENDER_SORT_COLUMNS: Record<TenderSortField, OrderByBuilder> = {
  tenderNumber: (dir) => ({ tenderNumber: dir }),
  title: (dir) => ({ title: dir }),
  clientName: (dir) => ({ client: { name: dir } }),
  status: (dir) => ({ status: dir }),
  priority: (dir) => ({ priority: dir }),
  submissionDate: (dir) => ({ submissionDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  assigneeCount: (dir) => ({ assignees: { _count: dir } }),
};
