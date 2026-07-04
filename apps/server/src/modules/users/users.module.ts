import { EmailService } from "../../infra/mailer/email.service.js";
import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { AuthRepository } from "../auth/auth.repository.js";
import { RolesRepository } from "../roles/roles.repository.js";

import { UsersController } from "./users.controller.js";
import { UsersRepository } from "./users.repository.js";
import { createUsersRouter } from "./users.routes.js";
import { UsersService } from "./users.service.js";

const usersRepository = new UsersRepository(prisma);
const rolesRepository = new RolesRepository(prisma);
const authRepository = new AuthRepository(prisma);
const emailService = new EmailService();

export const usersService = new UsersService(
  usersRepository,
  rolesRepository,
  authRepository,
  auditService,
  attachmentsService,
  emailService,
);
const usersController = new UsersController(usersService);

export const usersRouter = createUsersRouter(usersController);
export { usersRepository };
