import { EmailService } from "../../infra/mailer/email.service.js";
import { prisma } from "../../infra/prisma/client.js";
import { attachmentsService } from "../attachments/attachments.module.js";
import { auditService } from "../audit/audit.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { rolesRepository } from "../roles/roles.module.js";
import { usersRepository } from "../users/users.module.js";

import { AuthController } from "./auth.controller.js";
import { AuthRepository } from "./auth.repository.js";
import { createAuthRouter } from "./auth.routes.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";

const authRepository = new AuthRepository(prisma);
const tokenService = new TokenService();
const emailService = new EmailService();

export const authService = new AuthService(
  usersRepository,
  authRepository,
  tokenService,
  auditService,
  attachmentsService,
  emailService,
  businessesRepository,
  rolesRepository,
);
const authController = new AuthController(authService);

export const authRouter = createAuthRouter(authController);
