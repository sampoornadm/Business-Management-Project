import type { FilterCondition } from "./filtering.js";

export const MSME_CATEGORIES = ["MICRO", "SMALL", "MEDIUM"] as const;
export type MsmeCategory = (typeof MSME_CATEGORIES)[number];

// isActive is intentionally excluded: it's a boolean column, and packages/ui's
// AddFilterPopover has no dedicated value-input for FilterColumnType "boolean" (it falls
// through to a raw text Input, requiring the user to type true/false — not worth wiring up
// for one column when the task is scoped to not touching packages/ui). Sorting isn't affected
// by that gap (no value input needed), so isActive stays sortable, just not filterable.
export const BUSINESS_FILTER_FIELDS = [
  "name",
  "code",
  "city",
  "state",
  "gstNumber",
  "panNumber",
  "msmeCategory",
] as const;
export type BusinessFilterField = (typeof BUSINESS_FILTER_FIELDS)[number];

export const BUSINESS_SORT_FIELDS = ["name", "code", "isActive", "tenderCount", "createdAt"] as const;
export type BusinessSortField = (typeof BUSINESS_SORT_FIELDS)[number];

export interface BusinessContactDto {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface BusinessDto {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstNumber: string | null;
  udyamRegistrationNumber: string | null;
  msmeCategory: MsmeCategory | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: BusinessContactDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessInput {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  udyamRegistrationNumber?: string;
  msmeCategory?: MsmeCategory;
  panNumber?: string;
  website?: string;
  notes?: string;
}

export type UpdateBusinessInput = Partial<CreateBusinessInput> & { isActive?: boolean };

export interface CreateBusinessContactInput {
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export type UpdateBusinessContactInput = Partial<CreateBusinessContactInput>;

export interface ListBusinessesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
  filters?: FilterCondition[];
  sortBy?: BusinessSortField;
  sortDir?: "asc" | "desc";
}
