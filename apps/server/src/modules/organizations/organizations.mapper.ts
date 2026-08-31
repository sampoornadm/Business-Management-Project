import type { ContactDto, OrganizationDto, OrganizationListItemDto } from "@bmp/types";

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
