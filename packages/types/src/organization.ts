import type { ContactDto } from "./contact.js";
import type { FilterCondition } from "./filtering.js";

export const ORGANIZATION_TYPES = ["GOVERNMENT", "PRIVATE"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_FILTER_FIELDS = ["name", "type", "city", "state"] as const;
export type OrganizationFilterField = (typeof ORGANIZATION_FILTER_FIELDS)[number];

// `tenderCount` is sortable (see organizations.filter-columns.ts) but not filterable — Prisma has
// no `where` filter for a relation's `_count`, only `orderBy`.
export const ORGANIZATION_SORT_FIELDS = ["name", "type", "city", "state", "tenderCount"] as const;
export type OrganizationSortField = (typeof ORGANIZATION_SORT_FIELDS)[number];

export interface OrganizationListItemDto {
  id: string;
  name: string;
  type: OrganizationType;
  city: string | null;
  state: string | null;
  tenderCount: number;
  createdAt: string;
}

export interface OrganizationDto extends OrganizationListItemDto {
  address: string | null;
  pincode: string | null;
  gstNumber: string | null;
  website: string | null;
  notes: string | null;
  contacts: ContactDto[];
  updatedAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  type: OrganizationType;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  website?: string;
  notes?: string;
}

export type UpdateOrganizationInput = Partial<CreateOrganizationInput>;

export interface ListOrganizationsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: OrganizationType;
  filters?: FilterCondition[];
  sortBy?: OrganizationSortField;
  sortDir?: "asc" | "desc";
}
