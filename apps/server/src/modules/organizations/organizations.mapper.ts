import type { OrganizationContactDto, OrganizationDto, OrganizationListItemDto } from "@bmp/types";

import type { OrganizationWithContacts } from "./organizations.repository.js";

function toContactDto(contact: OrganizationWithContacts["contacts"][number]): OrganizationContactDto {
  return {
    id: contact.id,
    name: contact.name,
    designation: contact.designation,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
  };
}

export function toOrganizationListItemDto(entity: OrganizationWithContacts): OrganizationListItemDto {
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

export function toOrganizationDto(entity: OrganizationWithContacts): OrganizationDto {
  return {
    ...toOrganizationListItemDto(entity),
    address: entity.address,
    pincode: entity.pincode,
    gstNumber: entity.gstNumber,
    website: entity.website,
    notes: entity.notes,
    contacts: entity.contacts.map(toContactDto),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
