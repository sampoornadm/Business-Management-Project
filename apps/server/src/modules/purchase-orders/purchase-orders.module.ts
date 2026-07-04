import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { RfqRepository } from "../rfq/rfq.repository.js";
import { TendersRepository } from "../tenders/tenders.repository.js";
import { vendorsRepository } from "../vendors/vendors.module.js";

import { PurchaseOrdersController } from "./purchase-orders.controller.js";
import { PurchaseOrdersRepository } from "./purchase-orders.repository.js";
import { createPurchaseOrdersRouter } from "./purchase-orders.routes.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";

const purchaseOrdersRepository = new PurchaseOrdersRepository(prisma);
const rfqRepository = new RfqRepository(prisma);
const tendersRepository = new TendersRepository(prisma);

export const purchaseOrdersService = new PurchaseOrdersService(
  purchaseOrdersRepository,
  rfqRepository,
  tendersRepository,
  vendorsRepository,
  auditService,
);
const purchaseOrdersController = new PurchaseOrdersController(purchaseOrdersService);

export const purchaseOrdersRouter = createPurchaseOrdersRouter(purchaseOrdersController);
