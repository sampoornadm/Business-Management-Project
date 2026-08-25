import { prisma } from "../../infra/prisma/client.js";

import { CategoriesController } from "./categories.controller.js";
import { CategoriesRepository } from "./categories.repository.js";
import { createCategoriesRouter } from "./categories.routes.js";
import { CategoriesService } from "./categories.service.js";

export const categoriesRepository = new CategoriesRepository(prisma);
export const categoriesService = new CategoriesService(categoriesRepository);
const categoriesController = new CategoriesController(categoriesService);

export const categoriesRouter = createCategoriesRouter(categoriesController);
