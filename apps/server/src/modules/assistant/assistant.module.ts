import { prisma } from "../../infra/prisma/client.js";
import { roleHasPermission } from "../../shared/middleware/requirePermission.middleware.js";
import { reportsService } from "../reports/reports.module.js";

import { AssistantController } from "./assistant.controller.js";
import { AssistantRepository } from "./assistant.repository.js";
import { createAssistantRouter } from "./assistant.routes.js";
import { AssistantService } from "./assistant.service.js";

const assistantRepository = new AssistantRepository(prisma);
const assistantService = new AssistantService(reportsService, assistantRepository, roleHasPermission);
const assistantController = new AssistantController(assistantService);

export const assistantRouter = createAssistantRouter(assistantController);
