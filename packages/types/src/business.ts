export const MSME_CATEGORIES = ["MICRO", "SMALL", "MEDIUM"] as const;
export type MsmeCategory = (typeof MSME_CATEGORIES)[number];

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
  msmeCategory: MsmeCategory | null;
  panNumber: string | null;
  website: string | null;
  notes: string | null;
  isActive: boolean;
  tenderCount: number;
  contacts: BusinessContactDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateBusinessInput {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  udyamRegistrationNumber?: string;
  msmeCategory?: MsmeCategory;
  panNumber?: string;
  website?: string;
  notes?: string;
}

export type UpdateBusinessInput = Partial<CreateBusinessInput> & { isActive?: boolean };

export interface CreateBusinessContactInput {
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export type UpdateBusinessContactInput = Partial<CreateBusinessContactInput>;

export interface ListBusinessesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
}
