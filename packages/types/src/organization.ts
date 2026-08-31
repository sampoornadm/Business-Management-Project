import type { ContactDto } from "./contact.js";

export const ORGANIZATION_TYPES = ["GOVERNMENT", "PRIVATE"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

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
  contacts: ContactDto[];
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

export interface ListOrganizationsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: OrganizationType;
}
