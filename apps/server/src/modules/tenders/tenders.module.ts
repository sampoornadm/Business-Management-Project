import { generateJson } from "../../infra/llm/ollama.client.js";
import { EmailService } from "../../infra/mailer/email.service.js";
import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { notificationsService } from "../notifications/notifications.module.js";
import { organizationsRepository } from "../organizations/organizations.module.js";
import { TagsRepository } from "../tags/tags.repository.js";
import { usersRepository } from "../users/users.module.js";

import { extractDocumentText } from "./tender-extraction.parser.js";
import { TenderExtractionService } from "./tender-extraction.service.js";
import { TendersController } from "./tenders.controller.js";
import { TendersRepository } from "./tenders.repository.js";
import { createTendersRouter } from "./tenders.routes.js";
import { TendersService } from "./tenders.service.js";

export const tendersRepository = new TendersRepository(prisma);
const tagsRepository = new TagsRepository(prisma);
const emailService = new EmailService();

export const tendersService = new TendersService(
  tendersRepository,
  organizationsRepository,
  usersRepository,
  tagsRepository,
  auditService,
  attachmentsService,
  notificationsService,
  emailService,
);
const tenderExtractionService = new TenderExtractionService(
  organizationsRepository,
  generateJson,
  extractDocumentText,
);
const tendersController = new TendersController(tendersService, tenderExtractionService);

export const tendersRouter = createTendersRouter(tendersController);
