import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { ClientPurchaseOrdersService } from "./client-purchase-orders.service.js";
import type {
  CreateClientPurchaseOrderBody,
  UpdateClientPurchaseOrderBody,
} from "./client-purchase-orders.validation.js";

export class ClientPurchaseOrdersController {
  constructor(private readonly service: ClientPurchaseOrdersService) {}

  listForProject = asyncHandler(async (req, res) => {
    const result = await this.service.listForProject(req.params.projectId!, req.user!.businessId);
    sendSuccess(res, result, "Client purchase orders retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const order = await this.service.create(
      req.params.projectId!,
      req.body as CreateClientPurchaseOrderBody,
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, order, "Client purchase order recorded", 201);
  });

  extract = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const result = await this.service.extract(
      req.params.projectId!,
      req.file.buffer,
      req.file.mimetype,
      req.user!.businessId,
    );
    sendSuccess(res, result, "Fields read from the purchase order");
  });

  getById = asyncHandler(async (req, res) => {
    const order = await this.service.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, order, "Client purchase order retrieved");
  });

  update = asyncHandler(async (req, res) => {
    const order = await this.service.update(
      req.params.id!,
      req.body as UpdateClientPurchaseOrderBody,
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, order, "Client purchase order updated");
  });

  delete = asyncHandler(async (req, res) => {
    await this.service.delete(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, null, "Client purchase order deleted");
  });

  uploadDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const order = await this.service.uploadDocument(
      req.params.id!,
      { buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype },
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, order, "Purchase order document uploaded");
  });
}
