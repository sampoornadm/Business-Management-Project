import type { BusinessContactDto, BusinessDto, MsmeCategory } from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { BusinessWithContacts } from "./businesses.repository.js";

function toContactDto(contact: BusinessWithContacts["contacts"][number]): BusinessContactDto {
  return {
    id: contact.id,
    name: contact.name,
    designation: contact.designation,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
  };
}

export function toBusinessDto(business: BusinessWithContacts): BusinessDto {
  return {
    id: business.id,
    name: business.name,
    code: business.code,
    address: business.address,
    city: business.city,
    state: business.state,
    pincode: business.pincode,
    gstNumber: business.gstNumber,
    udyamRegistrationNumber: business.udyamRegistrationNumber,
    msmeCategory: business.msmeCategory as MsmeCategory | null,
    panNumber: business.panNumber,
    website: business.website,
    notes: business.notes,
    isActive: business.isActive,
    tenderCount: business._count.tenders,
    contacts: business.contacts.map(toContactDto),
    createdAt: business.createdAt.toISOString(),
    updatedAt: business.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/businesses/business-column-registry.tsx's
// BUSINESS_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const BUSINESS_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "name", header: "Name" },
  { key: "code", header: "Code" },
  { key: "tenderCount", header: "Tenders" },
  { key: "isActive", header: "Status" },
  { key: "city", header: "City" },
  { key: "state", header: "State" },
  { key: "gstNumber", header: "GST Number" },
  { key: "panNumber", header: "PAN Number" },
  { key: "msmeCategory", header: "MSME Category" },
  { key: "createdAt", header: "Created" },
];

function businessExportRow(business: BusinessDto): Record<string, string | number> {
  return {
    name: business.name,
    code: business.code,
    tenderCount: business.tenderCount,
    isActive: business.isActive ? "Active" : "Inactive",
    city: business.city ?? "",
    state: business.state ?? "",
    gstNumber: business.gstNumber ?? "",
    panNumber: business.panNumber ?? "",
    msmeCategory: business.msmeCategory ?? "",
    createdAt: business.createdAt.slice(0, 10),
  };
}

export function buildBusinessExportTable(
  businesses: BusinessDto[],
  columnKeys: string[],
): ExportableTable {
  const columnsByKey = new Map(BUSINESS_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = businesses.map((business) => {
    const fullRow = businessExportRow(business);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Businesses", columns, rows };
}

export const BUSINESS_EXPORT_COLUMN_KEYS = BUSINESS_EXPORT_COLUMNS.map((column) => column.key);
