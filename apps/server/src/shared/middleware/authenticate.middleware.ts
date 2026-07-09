import type { NextFunction, Request, Response } from "express";

import { UnauthorizedError } from "../../core/errors/HttpErrors.js";
import { TokenService } from "../../modules/auth/token.service.js";

export interface AuthenticatedUser {
  id: string;
  roleId: string;
  roleName: string;
  businessId: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
  }
}

const tokenService = new TokenService();

export function authenticateMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(new UnauthorizedError("Missing access token"));
    return;
  }

  const token = header.slice("Bearer ".length);
  const payload = tokenService.verifyAccessToken(token);
  req.user = { id: payload.sub, roleId: payload.roleId, roleName: payload.roleName, businessId: payload.businessId };
  next();
}
