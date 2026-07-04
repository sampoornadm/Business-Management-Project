import type { PermissionDto } from "@bmp/types";

import type { IPermissionsRepository } from "./permissions.repository.js";

export class PermissionsService {
  constructor(private readonly permissionsRepository: IPermissionsRepository) {}

  async listPermissions(): Promise<PermissionDto[]> {
    const permissions = await this.permissionsRepository.findAll();
    return permissions.map((p) => ({
      id: p.id,
      key: p.key,
      resource: p.resource,
      action: p.action,
      description: p.description,
    }));
  }
}
