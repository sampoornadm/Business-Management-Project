import type { RoleWithPermissionsDto } from "@bmp/types";

import type { RoleWithPermissions } from "./roles.repository.js";

export function toRoleWithPermissionsDto(role: RoleWithPermissions): RoleWithPermissionsDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      key: rp.permission.key,
      resource: rp.permission.resource,
      action: rp.permission.action,
      description: rp.permission.description,
    })),
  };
}
