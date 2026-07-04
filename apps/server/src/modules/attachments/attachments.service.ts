import { randomUUID } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";

import { BadRequestError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { imageService } from "../../infra/storage/image.service.js";
import { s3Service } from "../../infra/storage/s3.service.js";
import { sha256 } from "../../shared/utils/hash.js";

import type { AttachmentWithUploader, IAttachmentsRepository } from "./attachments.repository.js";

export interface UploadFileParams {
  fileBuffer: Buffer;
  originalName: string;
  declaredMimeType: string;
  entityType: string;
  entityId: string;
  uploadedById: string;
  allowedMimeTypes: readonly string[];
  maxSizeBytes: number;
  generateImageVariants?: boolean;
  imageMaxDimension?: number;
  thumbnailDimension?: number;
  documentType?: string;
  replacesAttachmentId?: string;
}

export interface UploadFileResult {
  original: AttachmentWithUploader;
  thumbnail: AttachmentWithUploader | null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

function extensionFor(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

export class AttachmentsService {
  constructor(private readonly attachmentsRepository: IAttachmentsRepository) {}

  async upload(params: UploadFileParams): Promise<UploadFileResult> {
    if (params.fileBuffer.length > params.maxSizeBytes) {
      throw new BadRequestError(
        `File exceeds the maximum allowed size of ${Math.floor(params.maxSizeBytes / 1024 / 1024)}MB`,
      );
    }

    const sniffed = await fileTypeFromBuffer(params.fileBuffer);
    const detectedMimeType = sniffed?.mime ?? params.declaredMimeType;

    if (!params.allowedMimeTypes.includes(detectedMimeType)) {
      throw new BadRequestError(`Unsupported file type: ${detectedMimeType}`);
    }

    const isImage = detectedMimeType.startsWith("image/");
    const shouldGenerateVariants = Boolean(params.generateImageVariants) && isImage;

    const originalProcessed = shouldGenerateVariants
      ? await imageService.processOriginal(params.fileBuffer, params.imageMaxDimension ?? 1024)
      : { buffer: params.fileBuffer, contentType: detectedMimeType };

    const originalHash = sha256(originalProcessed.buffer);
    const originalStoredName = `${randomUUID()}-original.${extensionFor(originalProcessed.contentType)}`;
    const originalStoragePath = `${params.entityType.toLowerCase()}/${params.entityId}/${originalStoredName}`;

    await s3Service.putObject({
      key: originalStoragePath,
      body: originalProcessed.buffer,
      contentType: originalProcessed.contentType,
    });

    let documentGroupId: string | undefined;
    let nextVersion = 1;
    if (params.replacesAttachmentId) {
      const previous = await this.getById(params.replacesAttachmentId);
      documentGroupId = previous.documentGroupId ?? previous.id;
      const versions = await this.attachmentsRepository.findVersions(documentGroupId);
      nextVersion = Math.max(1, ...versions.map((v) => v.version)) + 1;
      await this.attachmentsRepository.markGroupNotCurrent(documentGroupId);
    }

    const original = await this.attachmentsRepository.create({
      originalName: params.originalName,
      storedName: originalStoredName,
      mimeType: originalProcessed.contentType,
      sizeBytes: originalProcessed.buffer.length,
      hash: originalHash,
      storageBucket: s3Service.bucket,
      storagePath: originalStoragePath,
      entityType: params.entityType,
      entityId: params.entityId,
      variant: "ORIGINAL",
      uploadedById: params.uploadedById,
      documentType: params.documentType,
      documentGroupId,
      version: nextVersion,
      isCurrent: true,
    });

    if (!documentGroupId) {
      await this.attachmentsRepository.setDocumentGroupId(original.id, original.id);
      // Reflect the just-set value on the object we're about to return, since
      // the row we hold in memory predates that update.
      original.documentGroupId = original.id;
    }

    let thumbnail: AttachmentWithUploader | null = null;
    if (shouldGenerateVariants) {
      const thumbProcessed = await imageService.processThumbnail(
        params.fileBuffer,
        params.thumbnailDimension ?? 128,
      );
      const thumbStoredName = `${randomUUID()}-thumb.${extensionFor(thumbProcessed.contentType)}`;
      const thumbStoragePath = `${params.entityType.toLowerCase()}/${params.entityId}/${thumbStoredName}`;

      await s3Service.putObject({
        key: thumbStoragePath,
        body: thumbProcessed.buffer,
        contentType: thumbProcessed.contentType,
      });

      thumbnail = await this.attachmentsRepository.create({
        originalName: params.originalName,
        storedName: thumbStoredName,
        mimeType: thumbProcessed.contentType,
        sizeBytes: thumbProcessed.buffer.length,
        hash: sha256(thumbProcessed.buffer),
        storageBucket: s3Service.bucket,
        storagePath: thumbStoragePath,
        entityType: params.entityType,
        entityId: params.entityId,
        variant: "THUMBNAIL",
        parentId: original.id,
        uploadedById: params.uploadedById,
      });
    }

    return { original, thumbnail };
  }

  async getById(id: string): Promise<AttachmentWithUploader> {
    const attachment = await this.attachmentsRepository.findById(id);
    if (!attachment) throw new NotFoundError("Attachment not found");
    return attachment;
  }

  async listByEntity(
    entityType: string,
    entityId: string,
    documentType?: string,
  ): Promise<AttachmentWithUploader[]> {
    return this.attachmentsRepository.findByEntity(entityType, entityId, documentType);
  }

  async getVariants(parentId: string): Promise<AttachmentWithUploader[]> {
    return this.attachmentsRepository.findVariants(parentId);
  }

  async listVersions(documentGroupId: string): Promise<AttachmentWithUploader[]> {
    return this.attachmentsRepository.findVersions(documentGroupId);
  }

  async deleteById(id: string): Promise<void> {
    const attachment = await this.getById(id);
    const variants = await this.attachmentsRepository.findVariants(id);

    await Promise.all(
      [attachment, ...variants].map((row) => s3Service.deleteObject(row.storagePath)),
    );

    await this.attachmentsRepository.delete(id);
  }
}
