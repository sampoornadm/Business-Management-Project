export const ORGANIZATION_TYPES = ["GOVERNMENT", "PRIVATE"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export interface OrganizationContactDto {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface OrganizationListItemDto {
  id: string;
  name: string;
  type: OrganizationType;
  city: string | null;
  state: string | null;
  tenderCount: number;
  createdAt: string;
}

export interface OrganizationDto extends OrganizationListItemDto {
  address: string | null;
  pincode: string | null;
  gstNumber: string | null;
  website: string | null;
  notes: string | null;
  contacts: OrganizationContactDto[];
  updatedAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  type: OrganizationType;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstNumber?: string;
  website?: string;
  notes?: string;
}

export type UpdateOrganizationInput = Partial<CreateOrganizationInput>;

export interface CreateOrganizationContactInput {
  name: string;
  designation?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
}

export type UpdateOrganizationContactInput = Partial<CreateOrganizationContactInput>;

export interface ListOrganizationsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: OrganizationType;
}
