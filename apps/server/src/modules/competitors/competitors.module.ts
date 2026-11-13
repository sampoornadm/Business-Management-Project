import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { portalBrowser } from "../portal-bid/portal-bid.module.js";

import { CompetitorsController } from "./competitors.controller.js";
import { CompetitorsRepository } from "./competitors.repository.js";
import { createCompetitorsRouter } from "./competitors.routes.js";
import { CompetitorsService } from "./competitors.service.js";
import { StatementFetchService, type StatementSource } from "./statement-fetch.service.js";

export const competitorsRepository = new CompetitorsRepository(prisma);
export const competitorsService = new CompetitorsService(competitorsRepository);

/**
 * The comparative statement is read from the portal browser window this server launched, with
 * the user's own login. Exported as an object so an integration test can stand in a canned grid.
 */
export const statementSource: StatementSource = {
  read: (rfxNumber) => portalBrowser.readComparativeMatrix(rfxNumber),
};

const statementFetchService = new StatementFetchService({
  repository: competitorsRepository,
  competitors: competitorsService,
  source: statementSource,
  audit: auditService,
});

export const competitorsRouter = createCompetitorsRouter(
  new CompetitorsController(competitorsService, statementFetchService),
);
