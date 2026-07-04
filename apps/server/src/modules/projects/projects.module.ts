import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { TendersRepository } from "../tenders/tenders.repository.js";

import { ProjectsController } from "./projects.controller.js";
import { ProjectsRepository } from "./projects.repository.js";
import { createProjectsRouter } from "./projects.routes.js";
import { ProjectsService } from "./projects.service.js";

const projectsRepository = new ProjectsRepository(prisma);
const tendersRepository = new TendersRepository(prisma);

export const projectsService = new ProjectsService(projectsRepository, tendersRepository, auditService);
const projectsController = new ProjectsController(projectsService);

export const projectsRouter = createProjectsRouter(projectsController);
