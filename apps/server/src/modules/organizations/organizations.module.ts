import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { contactsService } from "../contacts/contacts.module.js";

import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsRepository } from "./organizations.repository.js";
import { createOrganizationsRouter } from "./organizations.routes.js";
import { OrganizationsService } from "./organizations.service.js";

const organizationsRepository = new OrganizationsRepository(prisma);
export const organizationsService = new OrganizationsService(organizationsRepository, auditService, contactsService);
const organizationsController = new OrganizationsController(organizationsService);

export const organizationsRouter = createOrganizationsRouter(organizationsController);
export { organizationsRepository };
