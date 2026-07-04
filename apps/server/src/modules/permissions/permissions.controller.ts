import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { PermissionsService } from "./permissions.service.js";

export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  list = asyncHandler(async (_req, res) => {
    const permissions = await this.permissionsService.listPermissions();
    sendSuccess(res, permissions, "Permissions retrieved");
  });
}
