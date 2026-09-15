import type { Prisma } from "@bmp/database";
import type { VendorFilterField, VendorSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const VENDOR_FILTER_COLUMNS: Record<VendorFilterField, FilterableColumnDescriptor> = {
  name: { type: "text", prismaPath: ["name"] },
  category: { type: "enum", prismaPath: ["category"] },
  city: { type: "text", prismaPath: ["city"], nullable: true },
  state: { type: "text", prismaPath: ["state"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.VendorOrderByWithRelationInput;

// `isActive` is a native boolean column, sortable directly — unlike Tenders' assigneeCount or
// Organizations' tenderCount, no relation `_count` involved.
export const VENDOR_SORT_COLUMNS: Record<VendorSortField, OrderByBuilder> = {
  name: (dir) => ({ name: dir }),
  category: (dir) => ({ category: dir }),
  city: (dir) => ({ city: dir }),
  state: (dir) => ({ state: dir }),
  isActive: (dir) => ({ isActive: dir }),
};
