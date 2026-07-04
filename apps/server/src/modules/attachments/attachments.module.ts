import { prisma } from "../../infra/prisma/client.js";

import { AttachmentsController } from "./attachments.controller.js";
import { AttachmentsRepository } from "./attachments.repository.js";
import { createAttachmentsRouter } from "./attachments.routes.js";
import { AttachmentsService } from "./attachments.service.js";

const attachmentsRepository = new AttachmentsRepository(prisma);
export const attachmentsService = new AttachmentsService(attachmentsRepository);
const attachmentsController = new AttachmentsController(attachmentsService);

export const attachmentsRouter = createAttachmentsRouter(attachmentsController);
