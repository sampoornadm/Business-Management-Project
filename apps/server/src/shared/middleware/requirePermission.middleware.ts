import { WILDCARD_PERMISSION } from "@bmp/types";
import type { NextFunction, Request, RequestHandler, Response } from "express";


import { ForbiddenError, UnauthorizedError } from "../../core/errors/HttpErrors.js";
import { prisma } from "../../infra/prisma/client.js";
import { getCachedRolePermissions, setCachedRolePermissions } from "../../infra/redis/cache.js";

async function loadRolePermissionKeys(roleId: string): Promise<string[]> {
  const cached = await getCachedRolePermissions(roleId);
  if (cached) return cached;

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: { select: { key: true } } },
  });
  const keys = rolePermissions.map((rp) => rp.permission.key);
  await setCachedRolePermissions(roleId, keys);
  return keys;
}

function isAuthorized(permissionKeys: string[], required: string): boolean {
  if (permissionKeys.includes(WILDCARD_PERMISSION)) return true;
  if (permissionKeys.includes(required)) return true;
  const [resource] = required.split(":");
  return permissionKeys.includes(`${resource}:*`);
}

export function requirePermission(permissionKey: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }
      const permissionKeys = await loadRolePermissionKeys(req.user.roleId);
      if (!isAuthorized(permissionKeys, permissionKey)) {
        throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
