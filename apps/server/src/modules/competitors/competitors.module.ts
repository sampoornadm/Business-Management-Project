import { prisma } from "../../infra/prisma/client.js";

import { CompetitorsController } from "./competitors.controller.js";
import { CompetitorsRepository } from "./competitors.repository.js";
import { createCompetitorsRouter } from "./competitors.routes.js";
import { CompetitorsService } from "./competitors.service.js";

export const competitorsRepository = new CompetitorsRepository(prisma);
export const competitorsService = new CompetitorsService(competitorsRepository);

export const competitorsRouter = createCompetitorsRouter(new CompetitorsController(competitorsService));
