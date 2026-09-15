import type { ContactDto, OrganizationDto, OrganizationListItemDto } from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { OrganizationEntity } from "./organizations.repository.js";

export function toOrganizationListItemDto(entity: OrganizationEntity): OrganizationListItemDto {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    city: entity.city,
    state: entity.state,
    tenderCount: entity._count.tenders,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toOrganizationDto(entity: OrganizationEntity, contacts: ContactDto[]): OrganizationDto {
  return {
    ...toOrganizationListItemDto(entity),
    address: entity.address,
    pincode: entity.pincode,
    gstNumber: entity.gstNumber,
    website: entity.website,
    notes: entity.notes,
    contacts,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/organizations/organization-column-registry.tsx's
// ORGANIZATION_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const ORGANIZATION_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "name", header: "Name" },
  { key: "type", header: "Type" },
  { key: "city", header: "City" },
  { key: "state", header: "State" },
  { key: "tenderCount", header: "Tenders" },
];

function organizationExportRow(organization: OrganizationListItemDto): Record<string, string | number> {
  return {
    name: organization.name,
    type: organization.type,
    city: organization.city ?? "",
    state: organization.state ?? "",
    tenderCount: organization.tenderCount,
  };
}

export function buildOrganizationExportTable(
  organizations: OrganizationListItemDto[],
  columnKeys: string[],
): ExportableTable {
  const columnsByKey = new Map(ORGANIZATION_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = organizations.map((organization) => {
    const fullRow = organizationExportRow(organization);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Organizations", columns, rows };
}

export const ORGANIZATION_EXPORT_COLUMN_KEYS = ORGANIZATION_EXPORT_COLUMNS.map((column) => column.key);
