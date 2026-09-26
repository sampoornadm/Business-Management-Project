import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { ItemsRepository } from "../items/items.repository.js";
import { HistoricalRatesRepository } from "../rates/rates.repository.js";
import { ReferenceDataRepository } from "../reference-data/reference-data.repository.js";
import { settingsService } from "../settings/settings.module.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { BoqEnrichmentService } from "./boq-enrichment.service.js";
import { BoqController } from "./boq.controller.js";
import { BoqRepository } from "./boq.repository.js";
import { createBoqItemsRouter, createBoqRouter } from "./boq.routes.js";
import { BoqService } from "./boq.service.js";

export const boqRepository = new BoqRepository(prisma);
const tendersRepository = new TendersRepository(prisma);
const historicalRatesRepository = new HistoricalRatesRepository(prisma);
// A fresh instance, not items.module.ts's singleton — reusing that would import rfq.module.ts
// (ItemsService depends on RfqService), which itself imports boqRepository from this very
// module, closing a circular import (boq -> items -> rfq -> boq) that crashes at startup.
// ItemsRepository holds no state beyond the Prisma client, so a second instance is harmless —
// same reasoning as tendersRepository/historicalRatesRepository above.
const itemsRepository = new ItemsRepository(prisma);
const referenceDataRepository = new ReferenceDataRepository(prisma);

// Exported for the ai-enrichment worker, which runs in the worker process (no router).
export const boqEnrichmentService = new BoqEnrichmentService(
  boqRepository,
  historicalRatesRepository,
  itemsRepository,
  referenceDataRepository,
  settingsService,
);

export const boqService = new BoqService(
  boqRepository,
  tendersRepository,
  attachmentsService,
  auditService,
  historicalRatesRepository,
  itemsRepository,
);
const boqController = new BoqController(boqService);

export const boqRouter = createBoqRouter(boqController);
export const boqItemsRouter = createBoqItemsRouter(boqController);
