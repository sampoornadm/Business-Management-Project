import type { ContactDto } from "./contact.js";
import type { FilterCondition } from "./filtering.js";

export const VENDOR_CATEGORIES = [
  "MATERIAL_SUPPLIER",
  "SERVICE_PROVIDER",
  "SUBCONTRACTOR",
  "EQUIPMENT_RENTAL",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export const VENDOR_FILTER_FIELDS = ["name", "category", "city", "state"] as const;
export type VendorFilterField = (typeof VENDOR_FILTER_FIELDS)[number];

// `averageRating` is display-only (no sort/filter): it's a derived average over VendorRating
// rows, and Prisma's relation-aggregate `orderBy` only supports `_count`, not `_avg`, for
// to-many relations — there's no clean way to sort by it without a raw query or a denormalized
// column, out of scope for wiring up list-page filters/sort.
export const VENDOR_SORT_FIELDS = ["name", "category", "city", "state", "isActive"] as const;
export type VendorSortField = (typeof VENDOR_SORT_FIELDS)[number];

export interface VendorListItemDto {
  id: string;
  name: string;
  category: VendorCategory;
  city: string | null;
  state: string | null;
  isActive: boolean;
  averageRating: number | null;
  totalRatings: number;
  createdAt: string;
}

export interface VendorItemTagDto {
  id: string;
  itemType: string;
  make: string | null;
  createdAt: string;
}

export interface VendorDto extends VendorListItemDto {
  gstNumber: string | null;
  panNumber: string | null;
  address: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfscCode: string | null;
  notes: string | null;
  contacts: ContactDto[];
  itemTags: VendorItemTagDto[];
  updatedAt: string;
}

export interface CreateVendorInput {
  name: string;
  category: VendorCategory;
  gstNumber?: string;
  panNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfscCode?: string;
  notes?: string;
}

export type UpdateVendorInput = Partial<CreateVendorInput> & { isActive?: boolean };

export interface CreateVendorItemTagInput {
  itemType: string;
  make?: string;
}

export interface ImportVendorItemTagsSkippedRow {
  row: number;
  vendorName: string;
  reason: string;
}

export interface ImportVendorItemTagsResult {
  imported: number;
  skipped: ImportVendorItemTagsSkippedRow[];
}

export interface ListVendorsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: VendorCategory;
  isActive?: boolean;
  filters?: FilterCondition[];
  sortBy?: VendorSortField;
  sortDir?: "asc" | "desc";
}

export interface VendorRatingDto {
  id: string;
  purchaseOrderId: string;
  rating: number;
  remarks: string | null;
  ratedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface VendorPerformanceDto {
  vendorId: string;
  averageRating: number | null;
  totalRatings: number;
  ratings: VendorRatingDto[];
}
