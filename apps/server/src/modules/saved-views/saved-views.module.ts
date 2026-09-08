import { prisma } from "../../infra/prisma/client.js";

import { SavedViewsController } from "./saved-views.controller.js";
import { SavedViewsRepository } from "./saved-views.repository.js";
import { createSavedViewsRouter } from "./saved-views.routes.js";
import { SavedViewsService } from "./saved-views.service.js";

const savedViewsRepository = new SavedViewsRepository(prisma);
export const savedViewsService = new SavedViewsService(savedViewsRepository);
const savedViewsController = new SavedViewsController(savedViewsService);

export const savedViewsRouter = createSavedViewsRouter(savedViewsController);
