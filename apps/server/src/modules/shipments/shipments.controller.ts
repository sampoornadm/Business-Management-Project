import {
  type CreateShipmentInput,
  type DispatchShipmentInput,
  READABLE_DOCUMENT_KINDS,
  type ReadableDocumentKind,
  type RecordShipmentGrnInput,
  type RecordShipmentPaymentInput,
  type ShipmentDocumentType,
  type UpdateShipmentInput,
} from "@bmp/types";
import type { Request } from "express";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { ShipmentDocumentReader } from "./shipments.documents.js";
import type { ShipmentsService } from "./shipments.service.js";

function contextOf(req: Request): ScopedRequestContext {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId };
}

export class ShipmentsController {
  constructor(
    private readonly service: ShipmentsService,
    private readonly documentReader: ShipmentDocumentReader,
  ) {}

  readDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const kind = (req.body as { kind?: string }).kind || undefined;
    if (kind && !(READABLE_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestError("Unknown document kind");
    }
    const result = await this.documentReader.read(
      req.params.projectId!,
      req.file.buffer,
      req.file.mimetype,
      kind as ReadableDocumentKind | undefined,
      req.user!.businessId,
    );
    sendSuccess(res, result, "Document read");
  });

  getSupply = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.service.getSupply(req.params.projectId!, req.user!.businessId), "Supply retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const shipment = await this.service.create(
      req.params.projectId!,
      req.body as CreateShipmentInput,
      req.user!.id,
      contextOf(req),
    );
    sendSuccess(res, shipment, "Shipment created", 201);
  });

  getById = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.service.getById(req.params.id!, req.user!.businessId), "Shipment retrieved");
  });

  update = asyncHandler(async (req, res) => {
    const shipment = await this.service.update(req.params.id!, req.body as UpdateShipmentInput, req.user!.id, contextOf(req));
    sendSuccess(res, shipment, "Shipment updated");
  });

  dispatch = asyncHandler(async (req, res) => {
    const shipment = await this.service.dispatch(req.params.id!, req.body as DispatchShipmentInput, req.user!.id, contextOf(req));
    sendSuccess(res, shipment, "Shipment dispatched");
  });

  recordGrn = asyncHandler(async (req, res) => {
    const shipment = await this.service.recordGrn(req.params.id!, req.body as RecordShipmentGrnInput, req.user!.id, contextOf(req));
    sendSuccess(res, shipment, "GRN recorded");
  });

  createBill = asyncHandler(async (req, res) => {
    const shipment = await this.service.createBill(req.params.id!, req.user!.id, contextOf(req));
    sendSuccess(res, shipment, "Bill raised");
  });

  recordPayment = asyncHandler(async (req, res) => {
    const shipment = await this.service.recordPayment(
      req.params.id!,
      req.body as RecordShipmentPaymentInput,
      req.user!.id,
      contextOf(req),
    );
    sendSuccess(res, shipment, "Payment recorded");
  });

  undo = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.service.undo(req.params.id!, req.user!.id, contextOf(req)), "Shipment stepped back");
  });

  delete = asyncHandler(async (req, res) => {
    await this.service.delete(req.params.id!, req.user!.id, contextOf(req));
    sendSuccess(res, null, "Shipment deleted");
  });

  uploadDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const shipment = await this.service.uploadDocument(
      req.params.id!,
      { buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype },
      (req.body as { documentType: ShipmentDocumentType }).documentType,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, shipment, "Document attached");
  });
}
