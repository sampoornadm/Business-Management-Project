import { prisma } from "../../infra/prisma/client.js";

import { NotificationsController } from "./notifications.controller.js";
import { NotificationsRepository } from "./notifications.repository.js";
import { createNotificationsRouter } from "./notifications.routes.js";
import { NotificationsService } from "./notifications.service.js";

const notificationsRepository = new NotificationsRepository(prisma);
export const notificationsService = new NotificationsService(notificationsRepository);
const notificationsController = new NotificationsController(notificationsService);

export const notificationsRouter = createNotificationsRouter(notificationsController);
