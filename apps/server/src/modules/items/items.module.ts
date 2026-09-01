import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { categoriesService } from "../categories/categories.module.js";
import { rfqService } from "../rfq/rfq.module.js";

import { ItemsController } from "./items.controller.js";
import { ItemsRepository } from "./items.repository.js";
import { createItemsRouter } from "./items.routes.js";
import { ItemsService } from "./items.service.js";

const itemsRepository = new ItemsRepository(prisma);
const itemsService = new ItemsService(itemsRepository, rfqService, categoriesService, auditService);
const itemsController = new ItemsController(itemsService);

export const itemsRouter = createItemsRouter(itemsController);
