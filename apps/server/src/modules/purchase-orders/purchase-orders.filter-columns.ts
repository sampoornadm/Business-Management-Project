import type { Prisma } from "@bmp/database";
import type { PurchaseOrderFilterField, PurchaseOrderSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

export const PURCHASE_ORDER_FILTER_COLUMNS: Record<PurchaseOrderFilterField, FilterableColumnDescriptor> = {
  poNumber: { type: "text", prismaPath: ["poNumber"] },
  // Type "enum" (not "text") so the frontend's "is"/"is_not"/"any_of" operators are all
  // permitted here — the filter builder offers vendors as a pick-list (derived from vendors
  // currently in view, see apps/web purchase-orders page), not free text, but still matches by
  // exact name at this prismaPath (no vendor-id relation involved), same as tenders' clientName.
  vendorName: { type: "enum", prismaPath: ["vendor", "name"] },
  status: { type: "enum", prismaPath: ["status"] },
  expectedDeliveryDate: { type: "date", prismaPath: ["expectedDeliveryDate"], nullable: true },
};

type OrderByBuilder = (dir: "asc" | "desc") => Prisma.PurchaseOrderOrderByWithRelationInput;

// totalAmount is intentionally absent — it's a computed sum of item amounts, not a stored
// column, and Prisma has no `orderBy` support for a relation-sum aggregate (unlike a relation
// `_count`, which tenders' assigneeCount uses).
export const PURCHASE_ORDER_SORT_COLUMNS: Record<PurchaseOrderSortField, OrderByBuilder> = {
  poNumber: (dir) => ({ poNumber: dir }),
  vendorName: (dir) => ({ vendor: { name: dir } }),
  status: (dir) => ({ status: dir }),
  expectedDeliveryDate: (dir) => ({ expectedDeliveryDate: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};
