import { prisma as basePrisma } from "@bmp/database";

import { prisma } from "../../infra/prisma/client.js";

import { AuditController } from "./audit.controller.js";
import { AuditRepository } from "./audit.repository.js";
import { createAuditRouter } from "./audit.routes.js";
import { AuditService } from "./audit.service.js";
import { createEntityCodeResolver } from "./entity-code.js";

const auditRepository = new AuditRepository(prisma);
// Unscoped base client: entity codes are by-id lookups for a global log (see entity-code.ts).
export const auditService = new AuditService(auditRepository, createEntityCodeResolver(basePrisma));
const auditController = new AuditController(auditService);

export const auditRouter = createAuditRouter(auditController);
