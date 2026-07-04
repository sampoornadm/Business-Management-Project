import { prisma } from "../../infra/prisma/client.js";

import { RolesController } from "./roles.controller.js";
import { RolesRepository } from "./roles.repository.js";
import { createRolesRouter } from "./roles.routes.js";
import { RolesService } from "./roles.service.js";

const rolesRepository = new RolesRepository(prisma);
export const rolesService = new RolesService(rolesRepository);
const rolesController = new RolesController(rolesService);

export const rolesRouter = createRolesRouter(rolesController);
