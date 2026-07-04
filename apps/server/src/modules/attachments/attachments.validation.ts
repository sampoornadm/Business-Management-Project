import { z } from "zod";

export const listAttachmentsQuerySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
});
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;

export const uploadAttachmentBodySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
});
export type UploadAttachmentBody = z.infer<typeof uploadAttachmentBodySchema>;
