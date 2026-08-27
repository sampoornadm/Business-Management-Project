import { reportsService } from "../reports/reports.module.js";

import { AssistantController } from "./assistant.controller.js";
import { createAssistantRouter } from "./assistant.routes.js";
import { AssistantService } from "./assistant.service.js";

const assistantService = new AssistantService(reportsService);
const assistantController = new AssistantController(assistantService);

export const assistantRouter = createAssistantRouter(assistantController);
