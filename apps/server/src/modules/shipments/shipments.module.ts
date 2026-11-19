import { generateJson } from "../../infra/llm/ollama.client.js";
import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { billsService } from "../bills/bills.module.js";
import { financeService } from "../finance/finance.module.js";
import { extractDocumentText } from "../tenders/tender-extraction.parser.js";

import { ShipmentsController } from "./shipments.controller.js";
import { ShipmentDocumentReader } from "./shipments.documents.js";
import { ShipmentsRepository } from "./shipments.repository.js";
import { createProjectSupplyRouter, createShipmentsRouter } from "./shipments.routes.js";
import { ShipmentsService } from "./shipments.service.js";

const repository = new ShipmentsRepository(prisma);
const service = new ShipmentsService(
  repository,
  attachmentsService,
  auditService,
  billsService,
  financeService,
);
const documentReader = new ShipmentDocumentReader(
  repository,
  // Same 15s ceiling as the client PO reader: a hung local model must not hang the upload.
  (prompt) => generateJson(prompt, undefined, { timeoutMs: 15_000 }),
  extractDocumentText,
);
const controller = new ShipmentsController(service, documentReader);

export const projectSupplyRouter = createProjectSupplyRouter(controller);
export const shipmentsRouter = createShipmentsRouter(controller);
