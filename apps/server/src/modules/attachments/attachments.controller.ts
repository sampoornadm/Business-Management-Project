import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import { toAttachmentDto } from "./attachments.mapper.js";
import type { AttachmentsService } from "./attachments.service.js";
import type { ListAttachmentsQuery, UploadAttachmentBody } from "./attachments.validation.js";

export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  list = asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.query as unknown as ListAttachmentsQuery;
    const attachments = await this.attachmentsService.listByEntity(entityType, entityId);
    const dtos = await Promise.all(attachments.map(toAttachmentDto));
    sendSuccess(res, dtos, "Attachments retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const attachment = await this.attachmentsService.getById(req.params.id!);
    sendSuccess(res, await toAttachmentDto(attachment), "Attachment retrieved");
  });

  upload = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const body = req.body as UploadAttachmentBody;

    const { original } = await this.attachmentsService.upload({
      fileBuffer: req.file.buffer,
      originalName: req.file.originalname,
      declaredMimeType: req.file.mimetype,
      entityType: body.entityType,
      entityId: body.entityId,
      uploadedById: req.user!.id,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: false,
    });

    sendSuccess(res, await toAttachmentDto(original), "File uploaded", 201);
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.attachmentsService.deleteById(req.params.id!);
    sendSuccess(res, null, "Attachment deleted");
  });
}
