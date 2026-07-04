import type { UserDto } from "@bmp/types";

import { s3Service } from "../../infra/storage/s3.service.js";
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
    role: { id: user.role.id, name: user.role.name as UserDto["role"]["name"], description: user.role.description },
    avatar,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
