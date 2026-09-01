import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { HistoricalRatesRepository } from "../rates/rates.repository.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { BoqEnrichmentService } from "./boq-enrichment.service.js";
import { BoqController } from "./boq.controller.js";
import { BoqRepository } from "./boq.repository.js";
import { createBoqItemsRouter, createBoqRouter } from "./boq.routes.js";
import { BoqService } from "./boq.service.js";

export const boqRepository = new BoqRepository(prisma);
const tendersRepository = new TendersRepository(prisma);
const historicalRatesRepository = new HistoricalRatesRepository(prisma);

// Exported for the ai-enrichment worker, which runs in the worker process (no router).
export const boqEnrichmentService = new BoqEnrichmentService(boqRepository, historicalRatesRepository);

export const boqService = new BoqService(
  boqRepository,
  tendersRepository,
  attachmentsService,
  auditService,
  historicalRatesRepository,
);
const boqController = new BoqController(boqService);

export const boqRouter = createBoqRouter(boqController);
export const boqItemsRouter = createBoqItemsRouter(boqController);
