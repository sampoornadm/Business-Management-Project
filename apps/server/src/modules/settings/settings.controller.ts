import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { SettingsService } from "./settings.service.js";
import type { SettingKeyParam, UpdateSettingBody } from "./settings.validation.js";

export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  list = asyncHandler(async (_req, res) => {
    const settings = await this.settingsService.listAll();
    sendSuccess(res, settings, "Settings retrieved");
  });

  update = asyncHandler(async (req, res) => {
    const { key } = req.params as unknown as SettingKeyParam;
    const body = req.body as UpdateSettingBody;
    const setting = await this.settingsService.set(key, body.value, req.user!.id);
    sendSuccess(res, setting, "Setting updated");
  });
}
