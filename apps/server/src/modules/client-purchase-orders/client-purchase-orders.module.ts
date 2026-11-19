import { generateJson } from "../../infra/llm/ollama.client.js";
import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { extractDocumentText } from "../tenders/tender-extraction.parser.js";

import { ClientPurchaseOrdersController } from "./client-purchase-orders.controller.js";
import { ClientPurchaseOrdersRepository } from "./client-purchase-orders.repository.js";
import {
  createClientPurchaseOrdersRouter,
  createProjectClientPurchaseOrdersRouter,
} from "./client-purchase-orders.routes.js";
import { ClientPurchaseOrdersService } from "./client-purchase-orders.service.js";

const repository = new ClientPurchaseOrdersRepository(prisma);
export const clientPurchaseOrdersService = new ClientPurchaseOrdersService(
  repository,
  attachmentsService,
  auditService,
  // Same 15s ceiling as the Assistant's model call: a hung local model must not hang the upload.
  (prompt) => generateJson(prompt, undefined, { timeoutMs: 15_000 }),
  extractDocumentText,
);
const controller = new ClientPurchaseOrdersController(clientPurchaseOrdersService);

export const projectClientPurchaseOrdersRouter = createProjectClientPurchaseOrdersRouter(controller);
export const clientPurchaseOrdersRouter = createClientPurchaseOrdersRouter(controller);
