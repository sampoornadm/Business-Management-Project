import type { UserDto } from "@bmp/types";

import { s3Service } from "../../infra/storage/s3.service.js";
import type { ExportableTable } from "../../shared/utils/table-export.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";

import type { UserWithRole } from "./users.repository.js";

export async function toUserDto(
  user: UserWithRole,
  attachmentsService: AttachmentsService,
): Promise<UserDto> {
  let avatar: UserDto["avatar"] = null;

  if (user.avatarAttachment) {
    const variants = await attachmentsService.getVariants(user.avatarAttachment.id);
    const thumbnail = variants.find((v) => v.variant === "THUMBNAIL") ?? null;
    const [url, thumbnailUrl] = await Promise.all([
      s3Service.getPresignedUrl(user.avatarAttachment.storagePath),
      thumbnail ? s3Service.getPresignedUrl(thumbnail.storagePath) : Promise.resolve(null),
    ]);
    avatar = {
      id: user.avatarAttachment.id,
      url,
      thumbnailUrl,
      mimeType: user.avatarAttachment.mimeType,
      sizeBytes: user.avatarAttachment.sizeBytes,
    };
  }

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    isActive: user.isActive,
    isEmailVerified: user.isEmailVerified,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    role: {
      id: user.userBusinesses[0]!.role.id,
      name: user.userBusinesses[0]!.role.name as UserDto["role"]["name"],
      description: user.userBusinesses[0]!.role.description,
    },
    avatar,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/users/user-column-registry.tsx's
// USER_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const USER_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "firstName", header: "Name" },
  { key: "lastName", header: "Last Name" },
  { key: "email", header: "Email" },
  { key: "role", header: "Role" },
  { key: "isActive", header: "Status" },
  { key: "lastLoginAt", header: "Last Login" },
];

function userExportRow(user: UserDto): Record<string, string | number> {
  return {
    // The "firstName" column displays the full name in the UI (see user-column-registry.tsx),
    // so its export mirrors that rather than the bare first name alone.
    firstName: `${user.firstName} ${user.lastName}`.trim(),
    lastName: user.lastName,
    email: user.email,
    role: user.role.name,
    isActive: user.isActive ? "Active" : "Deactivated",
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.slice(0, 10) : "",
  };
}

export function buildUserExportTable(users: UserDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(USER_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = users.map((user) => {
    const fullRow = userExportRow(user);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Users", columns, rows };
}

export const USER_EXPORT_COLUMN_KEYS = USER_EXPORT_COLUMNS.map((column) => column.key);
