import type {
  ContactDto,
  VendorDto,
  VendorItemTagDto,
  VendorListItemDto,
  VendorPerformanceDto,
  VendorRatingDto,
} from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { VendorEntity, VendorRatingWithRater } from "./vendors.repository.js";

function toItemTagDto(tag: VendorEntity["itemTags"][number]): VendorItemTagDto {
  return {
    id: tag.id,
    itemType: tag.itemType,
    make: tag.make,
    createdAt: tag.createdAt.toISOString(),
  };
}

function averageOf(ratings: { rating: number }[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, r) => total + r.rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

export function toVendorListItemDto(entity: VendorEntity): VendorListItemDto {
  return {
    id: entity.id,
    name: entity.name,
    category: entity.category,
    city: entity.city,
    state: entity.state,
    isActive: entity.isActive,
    averageRating: averageOf(entity.ratings),
    totalRatings: entity.ratings.length,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toVendorDto(entity: VendorEntity, contacts: ContactDto[]): VendorDto {
  return {
    ...toVendorListItemDto(entity),
    gstNumber: entity.gstNumber,
    panNumber: entity.panNumber,
    address: entity.address,
    bankAccountName: entity.bankAccountName,
    bankAccountNumber: entity.bankAccountNumber,
    bankIfscCode: entity.bankIfscCode,
    notes: entity.notes,
    contacts,
    itemTags: entity.itemTags.map(toItemTagDto),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function toVendorRatingDto(entity: VendorRatingWithRater): VendorRatingDto {
  return {
    id: entity.id,
    purchaseOrderId: entity.purchaseOrderId,
    rating: entity.rating,
    remarks: entity.remarks,
    ratedBy: {
      id: entity.ratedBy.id,
      firstName: entity.ratedBy.firstName,
      lastName: entity.ratedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toVendorPerformanceDto(
  vendorId: string,
  ratings: VendorRatingWithRater[],
): VendorPerformanceDto {
  return {
    vendorId,
    averageRating: averageOf(ratings),
    totalRatings: ratings.length,
    ratings: ratings.map(toVendorRatingDto),
  };
}

// Keep this in exact sync with apps/web/src/components/vendors/vendor-column-registry.tsx's
// VENDOR_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const VENDOR_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "name", header: "Name" },
  { key: "category", header: "Category" },
  { key: "city", header: "City" },
  { key: "state", header: "State" },
  { key: "isActive", header: "Status" },
  { key: "averageRating", header: "Rating" },
];

function vendorExportRow(vendor: VendorListItemDto): Record<string, string | number> {
  return {
    name: vendor.name,
    category: vendor.category,
    city: vendor.city ?? "",
    state: vendor.state ?? "",
    isActive: vendor.isActive ? "Active" : "Inactive",
    averageRating: vendor.averageRating ?? "",
  };
}

export function buildVendorExportTable(vendors: VendorListItemDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(VENDOR_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = vendors.map((vendor) => {
    const fullRow = vendorExportRow(vendor);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Vendors", columns, rows };
}

export const VENDOR_EXPORT_COLUMN_KEYS = VENDOR_EXPORT_COLUMNS.map((column) => column.key);
