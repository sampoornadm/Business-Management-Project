import { prisma } from "../../infra/prisma/client.js";

import { RatesController } from "./rates.controller.js";
import { HistoricalRatesRepository } from "./rates.repository.js";
import { createRatesRouter } from "./rates.routes.js";
import { RatesService } from "./rates.service.js";

// Exported for cross-module reuse (e.g. rfq.module.ts's pushRatesToTender) —
// avoid re-instantiating a second HistoricalRatesRepository against the same prisma client.
export const ratesRepository = new HistoricalRatesRepository(prisma);
export const ratesService = new RatesService(ratesRepository);
const ratesController = new RatesController(ratesService);

export const ratesRouter = createRatesRouter(ratesController);
