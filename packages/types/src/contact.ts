export interface ContactPhoneDto {
  id: string;
  phone: string;
  isPrimary: boolean;
}

export interface ContactEmailDto {
  id: string;
  email: string;
  isPrimary: boolean;
}

export interface ContactDto {
  id: string;
  name: string;
  department: string | null;
  designation: string | null;
  notes: string | null;
  isPrimary: boolean;
  phones: ContactPhoneDto[];
  emails: ContactEmailDto[];
  createdAt: string;
}

export interface CreateContactPhoneInput {
  phone: string;
  isPrimary: boolean;
}

export interface CreateContactEmailInput {
  email: string;
  isPrimary: boolean;
}

export interface CreateContactInput {
  name: string;
  department?: string;
  designation?: string;
  notes?: string;
  isPrimary?: boolean;
  phones?: CreateContactPhoneInput[];
  emails?: CreateContactEmailInput[];
}

export type UpdateContactInput = Partial<CreateContactInput>;

export const CONTACT_LOOKUP_KINDS = ["DEPARTMENT", "DESIGNATION"] as const;
export type ContactLookupKind = (typeof CONTACT_LOOKUP_KINDS)[number];

export interface ContactLookupOptionsDto {
  kind: ContactLookupKind;
  values: string[];
}
