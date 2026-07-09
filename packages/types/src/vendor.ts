export const VENDOR_CATEGORIES = [
  "MATERIAL_SUPPLIER",
  "SERVICE_PROVIDER",
  "SUBCONTRACTOR",
  "EQUIPMENT_RENTAL",
] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

export interface VendorContactDto {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface VendorListItemDto {
  id: string;
  name: string;
  category: VendorCategory;
  city: string | null;
  state: string | null;
  isActive: boolean;
  averageRating: number | null;
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
  contacts: VendorContactDto[];
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

export interface CreateVendorContactInput {
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export type UpdateVendorContactInput = Partial<CreateVendorContactInput>;

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
