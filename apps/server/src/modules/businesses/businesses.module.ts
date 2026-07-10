import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { BusinessesController } from "./businesses.controller.js";
import { BusinessesRepository } from "./businesses.repository.js";
import { createBusinessesRouter } from "./businesses.routes.js";
import { BusinessesService } from "./businesses.service.js";

const businessesRepository = new BusinessesRepository(prisma);
export const businessesService = new BusinessesService(businessesRepository, auditService);
const businessesController = new BusinessesController(businessesService);

export const businessesRouter = createBusinessesRouter(businessesController);
export { businessesRepository };
