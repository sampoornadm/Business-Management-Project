import type { RoleWithPermissionsDto } from "@bmp/types";

import { toRoleWithPermissionsDto } from "./roles.mapper.js";
import type { IRolesRepository } from "./roles.repository.js";

export class RolesService {
  constructor(private readonly rolesRepository: IRolesRepository) {}

  async listRoles(): Promise<RoleWithPermissionsDto[]> {
    const roles = await this.rolesRepository.findAllWithPermissions();
    return roles.map(toRoleWithPermissionsDto);
  }
}
