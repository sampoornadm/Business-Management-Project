import type { Prisma } from "@bmp/database";
import type { UserFilterField, UserSortField } from "@bmp/types";

import type { FilterableColumnDescriptor } from "../../shared/utils/filtering.js";

// "role" is declared here (so the frontend/backend column set has one source of truth) but is
// NOT applied through the generic AND-composition in findMany below — see that method's comment
// for why (Role is a global table, not scoped per business; a naive independent `some` clause
// on the same to-many relation as businessId can match a user's role in the WRONG business).
export const USER_FILTER_COLUMNS: Record<UserFilterField, FilterableColumnDescriptor> = {
  email: { type: "text", prismaPath: ["email"] },
  firstName: { type: "text", prismaPath: ["firstName"] },
  lastName: { type: "text", prismaPath: ["lastName"] },
  role: { type: "enum", prismaPath: ["userBusinesses", "some", "roleId"] },
  isActive: { type: "boolean", prismaPath: ["isActive"] },
  lastLoginAt: { type: "date", prismaPath: ["lastLoginAt"], nullable: true },
};

type OrderByBuilder = (
  dir: "asc" | "desc",
) => Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];

// "role" is intentionally absent from UserSortField — see its comment in packages/types/src/user.ts.
export const USER_SORT_COLUMNS: Record<UserSortField, OrderByBuilder> = {
  email: (dir) => ({ email: dir }),
  // Secondary key keeps ties (same first name) in a stable, still-alphabetical order.
  firstName: (dir) => [{ firstName: dir }, { lastName: dir }],
  lastName: (dir) => [{ lastName: dir }, { firstName: dir }],
  isActive: (dir) => ({ isActive: dir }),
  lastLoginAt: (dir) => ({ lastLoginAt: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};
