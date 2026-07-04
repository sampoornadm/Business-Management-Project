import { prisma } from "../../infra/prisma/client.js";

import { AuditController } from "./audit.controller.js";
import { AuditRepository } from "./audit.repository.js";
import { createAuditRouter } from "./audit.routes.js";
import { AuditService } from "./audit.service.js";

const auditRepository = new AuditRepository(prisma);
export const auditService = new AuditService(auditRepository);
const auditController = new AuditController(auditService);

export const auditRouter = createAuditRouter(auditController);
