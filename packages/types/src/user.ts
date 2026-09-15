import type { FilterCondition } from "./filtering.js";
import type { ThemeColorKey } from "./theme.js";
import type { RoleName } from "./rbac.js";

export interface RoleSummaryDto {
  id: string;
  name: RoleName;
  description: string | null;
}

export interface AttachmentSummaryDto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  lastLoginAt: string | null;
  role: RoleSummaryDto;
  avatar: AttachmentSummaryDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  roleId: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  isActive?: boolean;
}

export interface UpdateOwnProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

export interface UpdateThemeColorInput {
  businessId: string;
  themeColor: ThemeColorKey;
}

export interface AssignRoleInput {
  roleId: string;
}

export const USER_FILTER_FIELDS = ["email", "firstName", "lastName", "role", "isActive", "lastLoginAt"] as const;
export type UserFilterField = (typeof USER_FILTER_FIELDS)[number];

// "role" is sortable via neither this list nor USER_SORT_COLUMNS — Role is reached through
// UserBusiness, a to-many relation from User's side, and Prisma can't order by a nested
// relation's own relation field (User -> UserBusiness -> Role.name) without raw SQL. It stays
// filterable (see users.filter-columns.ts) but not sortable.
export const USER_SORT_FIELDS = ["email", "firstName", "lastName", "isActive", "lastLoginAt", "createdAt"] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export interface ListUsersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  roleId?: string;
  isActive?: boolean;
  filters?: FilterCondition[];
  sortBy?: UserSortField;
  sortDir?: "asc" | "desc";
}
