import type { BusinessContactDto, BusinessDto, MsmeCategory } from "@bmp/types";

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
