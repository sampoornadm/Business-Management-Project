import { prisma } from "../../infra/prisma/client.js";

import { ReportsController } from "./reports.controller.js";
import { ReportsRepository } from "./reports.repository.js";
import { createReportsRouter, createSearchRouter } from "./reports.routes.js";
import { ReportsService } from "./reports.service.js";

const reportsRepository = new ReportsRepository(prisma);
export const reportsService = new ReportsService(reportsRepository);
const reportsController = new ReportsController(reportsService);

export const reportsRouter = createReportsRouter(reportsController);
export const searchRouter = createSearchRouter(reportsController);
