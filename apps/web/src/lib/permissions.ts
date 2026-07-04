import { ROLE_PERMISSION_MATRIX, type PermissionKey, type RoleName } from "@bmp/types";

/**
 * Client-side permission check used ONLY to conditionally render UI
 * (hide buttons/menu items a role can't use). This mirrors the server's
 * seed-time role -> permission matrix but is never the security boundary —
 * every mutating request is re-checked by requirePermission() on the server.
 */
export function hasPermission(roleName: RoleName | undefined, permission: PermissionKey): boolean {
  if (!roleName) return false;
  if (roleName === "SUPER_ADMIN") return true;
  return ROLE_PERMISSION_MATRIX[roleName]?.includes(permission) ?? false;
}
