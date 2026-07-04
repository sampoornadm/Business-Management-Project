export interface AttachmentDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string | null;
  entityId: string | null;
  variant: "ORIGINAL" | "THUMBNAIL";
  version: number;
  documentType: string | null;
  documentGroupId: string | null;
  isCurrent: boolean;
  url: string;
  uploadedBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface UploadAttachmentInput {
  entityType: string;
  entityId: string;
  documentType?: string;
  replacesAttachmentId?: string;
}
