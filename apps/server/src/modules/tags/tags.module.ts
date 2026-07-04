import { prisma } from "../../infra/prisma/client.js";

import { TagsController } from "./tags.controller.js";
import { TagsRepository } from "./tags.repository.js";
import { createTagsRouter } from "./tags.routes.js";
import { TagsService } from "./tags.service.js";

const tagsRepository = new TagsRepository(prisma);
export const tagsService = new TagsService(tagsRepository);
const tagsController = new TagsController(tagsService);

export const tagsRouter = createTagsRouter(tagsController);
