import { prisma } from "../../infra/prisma/client.js";

import { PermissionsController } from "./permissions.controller.js";
import { PermissionsRepository } from "./permissions.repository.js";
import { createPermissionsRouter } from "./permissions.routes.js";
import { PermissionsService } from "./permissions.service.js";

const permissionsRepository = new PermissionsRepository(prisma);
const permissionsService = new PermissionsService(permissionsRepository);
const permissionsController = new PermissionsController(permissionsService);

export const permissionsRouter = createPermissionsRouter(permissionsController);
