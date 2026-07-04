import { randomUUID } from "node:crypto";

import type { AttachmentVariant, Prisma, PrismaClient } from "@bmp/database";

const attachmentWithUploader = {
  include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.AttachmentDefaultArgs;

export type AttachmentWithUploader = Prisma.AttachmentGetPayload<typeof attachmentWithUploader>;

export interface CreateAttachmentData {
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  hash: string;
  storageBucket: string;
  storagePath: string;
  entityType?: string | null;
  entityId?: string | null;
  variant: AttachmentVariant;
  parentId?: string | null;
  uploadedById: string;
  documentType?: string | null;
  documentGroupId?: string | null;
  version?: number;
  isCurrent?: boolean;
}

export interface IAttachmentsRepository {
  create(data: CreateAttachmentData): Promise<AttachmentWithUploader>;
  findById(id: string): Promise<AttachmentWithUploader | null>;
  findByEntity(
    entityType: string,
    entityId: string,
    documentType?: string,
  ): Promise<AttachmentWithUploader[]>;
  findVariants(parentId: string): Promise<AttachmentWithUploader[]>;
  findVersions(documentGroupId: string): Promise<AttachmentWithUploader[]>;
  setDocumentGroupId(id: string, documentGroupId: string): Promise<void>;
  markGroupNotCurrent(documentGroupId: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export class AttachmentsRepository implements IAttachmentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(data: CreateAttachmentData): Promise<AttachmentWithUploader> {
    return this.prisma.attachment.create({
      data: { id: randomUUID(), ...data },
      ...attachmentWithUploader,
    });
  }

  findById(id: string): Promise<AttachmentWithUploader | null> {
    return this.prisma.attachment.findUnique({ where: { id }, ...attachmentWithUploader });
  }

  findByEntity(
    entityType: string,
    entityId: string,
    documentType?: string,
  ): Promise<AttachmentWithUploader[]> {
    return this.prisma.attachment.findMany({
      where: { entityType, entityId, variant: "ORIGINAL", isCurrent: true, documentType },
      orderBy: { createdAt: "desc" },
      ...attachmentWithUploader,
    });
  }

  findVariants(parentId: string): Promise<AttachmentWithUploader[]> {
    return this.prisma.attachment.findMany({ where: { parentId }, ...attachmentWithUploader });
  }

  findVersions(documentGroupId: string): Promise<AttachmentWithUploader[]> {
    return this.prisma.attachment.findMany({
      where: { documentGroupId },
      orderBy: { version: "desc" },
      ...attachmentWithUploader,
    });
  }

  async setDocumentGroupId(id: string, documentGroupId: string): Promise<void> {
    await this.prisma.attachment.update({ where: { id }, data: { documentGroupId } });
  }

  async markGroupNotCurrent(documentGroupId: string): Promise<void> {
    await this.prisma.attachment.updateMany({
      where: { documentGroupId },
      data: { isCurrent: false },
    });
  }

  async delete(id: string): Promise<void> {
    // Variant rows cascade-delete at the DB level via the parentId FK.
    await this.prisma.attachment.delete({ where: { id } });
  }
}
