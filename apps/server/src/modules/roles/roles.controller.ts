import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { RolesService } from "./roles.service.js";

export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  list = asyncHandler(async (_req, res) => {
    const roles = await this.rolesService.listRoles();
    sendSuccess(res, roles, "Roles retrieved");
  });
}
