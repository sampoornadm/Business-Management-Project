import { generateJson } from "../../infra/llm/ollama.client.js";
import { EmailService } from "../../infra/mailer/email.service.js";
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { boqRepository } from "../boq/boq.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { contactsService } from "../contacts/contacts.module.js";
import { ItemsRepository } from "../items/items.repository.js";
import { ratesRepository } from "../rates/rates.module.js";
import { settingsService } from "../settings/settings.module.js";
import { TendersRepository } from "../tenders/tenders.repository.js";
import { usersRepository } from "../users/users.module.js";
import { vendorsRepository } from "../vendors/vendors.module.js";

import { createQuotePasteAiReader } from "./quote-paste-ai.js";
import { RfqController } from "./rfq.controller.js";
import { RfqRepository } from "./rfq.repository.js";
import { createRfqItemsRouter, createRfqRouter } from "./rfq.routes.js";
import { RfqService } from "./rfq.service.js";

const rfqRepository = new RfqRepository(prisma);
const tendersRepository = new TendersRepository(prisma);
const emailService = new EmailService();

export const rfqService = new RfqService(
  rfqRepository,
  tendersRepository,
  vendorsRepository,
  boqRepository,
  usersRepository,
  businessesRepository,
  emailService,
  auditService,
  ratesRepository,
  contactsService,
  new ItemsRepository(prisma),
  createQuotePasteAiReader({
    getTemplate: () => settingsService.get<string>("PROMPT_RFQ_QUOTE_PASTE"),
    // 30s ceiling: only unread lines go in, and a hung local model must not hang the preview.
    generate: (prompt, schema) => generateJson(prompt, undefined, { schema, timeoutMs: 30_000, temperature: 0 }),
  }),
);
const rfqController = new RfqController(rfqService);

export const rfqRouter = createRfqRouter(rfqController);
export const rfqItemsRouter = createRfqItemsRouter(rfqController);
