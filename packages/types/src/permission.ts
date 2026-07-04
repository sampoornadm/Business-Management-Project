export interface PermissionDto {
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

export interface RoleWithPermissionsDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionDto[];
}
