import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { SettingsController } from "./settings.controller.js";
import { SettingsRepository } from "./settings.repository.js";
import { createSettingsRouter } from "./settings.routes.js";
import { SettingsService } from "./settings.service.js";

const settingsRepository = new SettingsRepository(prisma);
export const settingsService = new SettingsService(settingsRepository, auditService);
const settingsController = new SettingsController(settingsService);

export const settingsRouter = createSettingsRouter(settingsController);
