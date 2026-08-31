import type { ContactDto } from "@bmp/types";

import type { ContactWithChildren } from "./contacts.repository.js";

export function toContactDto(contact: ContactWithChildren): ContactDto {
  return {
    id: contact.id,
    name: contact.name,
    department: contact.department,
    designation: contact.designation,
    notes: contact.notes,
    isPrimary: contact.isPrimary,
    phones: contact.phones.map((phone) => ({ id: phone.id, phone: phone.phone, isPrimary: phone.isPrimary })),
    emails: contact.emails.map((email) => ({ id: email.id, email: email.email, isPrimary: email.isPrimary })),
    createdAt: contact.createdAt.toISOString(),
  };
}
