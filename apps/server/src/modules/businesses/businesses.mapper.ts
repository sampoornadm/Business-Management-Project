import type { BusinessWithContacts } from "./businesses.repository.js";

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
  msmeCategory: string | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: BusinessContactDto[];
  createdAt: string;
  updatedAt: string;
}

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
    msmeCategory: business.msmeCategory,
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
