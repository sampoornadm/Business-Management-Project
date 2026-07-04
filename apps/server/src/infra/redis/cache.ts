import { ROLE_PERMISSIONS_CACHE_TTL_SECONDS } from "../../config/constants.js";

import { redis } from "./client.js";

function roleKey(roleId: string): string {
  return `role:permissions:${roleId}`;
}

export async function getCachedRolePermissions(roleId: string): Promise<string[] | null> {
  const raw = await redis.get(roleKey(roleId));
  if (!raw) return null;
  return JSON.parse(raw) as string[];
}

export async function setCachedRolePermissions(roleId: string, keys: string[]): Promise<void> {
  await redis.set(roleKey(roleId), JSON.stringify(keys), "EX", ROLE_PERMISSIONS_CACHE_TTL_SECONDS);
}

export async function invalidateRolePermissions(roleId: string): Promise<void> {
  await redis.del(roleKey(roleId));
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}
