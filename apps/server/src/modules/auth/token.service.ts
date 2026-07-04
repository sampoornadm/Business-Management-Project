import jwt from "jsonwebtoken";

import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../core/errors/HttpErrors.js";

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export class TokenService {
  signAccessToken(payload: AccessTokenPayload): IssuedAccessToken {
    const expiresInSeconds = env.ACCESS_TOKEN_TTL_MINUTES * 60;
    const token = jwt.sign(payload, env.ACCESS_TOKEN_SECRET, { expiresIn: expiresInSeconds });
    return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET);
      if (typeof decoded === "string") throw new UnauthorizedError("Invalid access token");
      return {
        sub: decoded.sub as string,
        roleId: (decoded as jwt.JwtPayload & AccessTokenPayload).roleId,
        roleName: (decoded as jwt.JwtPayload & AccessTokenPayload).roleName,
      };
    } catch {
      throw new UnauthorizedError("Invalid or expired access token");
    }
  }

  getRefreshTokenExpiry(): Date {
    return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
