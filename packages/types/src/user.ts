import type { RoleName } from "./rbac.js";

export interface RoleSummaryDto {
  id: string;
  name: RoleName;
  description: string | null;
}

export interface AttachmentSummaryDto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string;
  sizeBytes: number;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  lastLoginAt: string | null;
  role: RoleSummaryDto;
  avatar: AttachmentSummaryDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  roleId: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  isActive?: boolean;
}

export interface UpdateOwnProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
}

export interface AssignRoleInput {
  roleId: string;
}

export interface ListUsersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  roleId?: string;
  isActive?: boolean;
}
