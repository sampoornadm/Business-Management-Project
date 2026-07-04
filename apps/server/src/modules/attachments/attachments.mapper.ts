import type { AttachmentDto } from "@bmp/types";

import { s3Service } from "../../infra/storage/s3.service.js";

import type { AttachmentWithUploader } from "./attachments.repository.js";

export async function toAttachmentDto(entity: AttachmentWithUploader): Promise<AttachmentDto> {
  const url = await s3Service.getPresignedUrl(entity.storagePath);
  return {
    id: entity.id,
    originalName: entity.originalName,
    mimeType: entity.mimeType,
    sizeBytes: entity.sizeBytes,
    entityType: entity.entityType,
    entityId: entity.entityId,
    variant: entity.variant,
    version: entity.version,
    documentType: entity.documentType,
    documentGroupId: entity.documentGroupId,
    isCurrent: entity.isCurrent,
    url,
    uploadedBy: {
      id: entity.uploadedBy.id,
      firstName: entity.uploadedBy.firstName,
      lastName: entity.uploadedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}
