import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { BoqController } from "./boq.controller.js";
import { BoqRepository } from "./boq.repository.js";
import { createBoqItemsRouter, createBoqRouter } from "./boq.routes.js";
import { BoqService } from "./boq.service.js";

export const boqRepository = new BoqRepository(prisma);
const tendersRepository = new TendersRepository(prisma);

export const boqService = new BoqService(boqRepository, tendersRepository, attachmentsService, auditService);
const boqController = new BoqController(boqService);

export const boqRouter = createBoqRouter(boqController);
export const boqItemsRouter = createBoqItemsRouter(boqController);
