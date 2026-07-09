import { EmailService } from "../../infra/mailer/email.service.js";
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { boqRepository } from "../boq/boq.module.js";
import { TendersRepository } from "../tenders/tenders.repository.js";
import { usersRepository } from "../users/users.module.js";
import { vendorsRepository } from "../vendors/vendors.module.js";

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
  emailService,
  auditService,
);
const rfqController = new RfqController(rfqService);

export const rfqRouter = createRfqRouter(rfqController);
export const rfqItemsRouter = createRfqItemsRouter(rfqController);
