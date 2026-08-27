import { auditService } from "../audit/audit.module.js";
import { prisma } from "../../infra/prisma/client.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { BillsController } from "./bills.controller.js";
import { BillsRepository } from "./bills.repository.js";
import { createBillsRouter } from "./bills.routes.js";
import { BillsService } from "./bills.service.js";

const billsRepository = new BillsRepository(prisma);
const tendersRepository = new TendersRepository(prisma);

export const billsService = new BillsService(billsRepository, tendersRepository, auditService);
const billsController = new BillsController(billsService);

export const billsRouter = createBillsRouter(billsController);
