import type {
  CreateShipmentInput,
  DispatchShipmentInput,
  ProjectSupplyDto,
  RecordShipmentGrnInput,
  RecordShipmentPaymentInput,
  ShipmentDocumentType,
  ShipmentDto,
  ShipmentItemInput,
  ShipmentStage,
  UpdateShipmentInput,
} from "@bmp/types";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import { toAttachmentDto } from "../attachments/attachments.mapper.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { BillsService } from "../bills/bills.service.js";
import type { FinanceService } from "../finance/finance.service.js";

import { buildSupplyLines, shipmentQuantityProblem, shipmentStage } from "./shipments.logic.js";
import { toShipmentDto } from "./shipments.mapper.js";
import type { IShipmentsRepository, ShipmentFieldsData, ShipmentWithDetails } from "./shipments.repository.js";

export const SHIPMENT_ENTITY_TYPE = "Shipment";

const STAGE_LABEL: Record<ShipmentStage, string> = {
  PREPARING: "being prepared",
  DISPATCHED: "dispatched",
  GRN_RECEIVED: "GRN received",
  BILLED: "billed",
  PAID: "paid",
};

export class ShipmentsService {
  constructor(
    private readonly repository: IShipmentsRepository,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly billsService: Pick<BillsService, "createBill">,
    private readonly financeService: Pick<FinanceService, "recordBillPayment">,
  ) {}

  private async getProjectOrThrow(projectId: string, businessId: string) {
    const project = await this.repository.findProject(projectId, businessId);
    if (!project) throw new NotFoundError("Project not found");
    return project;
  }

  private async getOrThrow(id: string, businessId: string): Promise<ShipmentWithDetails> {
    const shipment = await this.repository.findById(id, businessId);
    if (!shipment) throw new NotFoundError("Shipment not found");
    return shipment;
  }

  private assertStage(shipment: ShipmentWithDetails, allowed: ShipmentStage[], action: string): void {
    const stage = shipmentStage(shipment);
    if (!allowed.includes(stage)) {
      throw new ConflictError(`Shipment ${shipment.number} is ${STAGE_LABEL[stage]}; it cannot ${action}`);
    }
  }

  private async toDto(shipment: ShipmentWithDetails, businessId: string): Promise<ShipmentDto> {
    const [received, documents] = await Promise.all([
      shipment.billId ? this.repository.sumPaymentsByBill([shipment.billId], businessId) : new Map<string, number>(),
      this.attachmentsService.listByEntity(SHIPMENT_ENTITY_TYPE, shipment.id).then((rows) => Promise.all(rows.map(toAttachmentDto))),
    ]);
    return toShipmentDto(shipment, shipment.billId ? (received.get(shipment.billId) ?? 0) : 0, documents);
  }

  async getById(id: string, businessId: string): Promise<ShipmentDto> {
    return this.toDto(await this.getOrThrow(id, businessId), businessId);
  }

  async getSupply(projectId: string, businessId: string): Promise<ProjectSupplyDto> {
    const project = await this.getProjectOrThrow(projectId, businessId);
    const [clientLines, vendorLines, shipped, shipments] = await Promise.all([
      this.repository.findClientPoLines(projectId, businessId),
      this.repository.findVendorPoLines(project.tenderId, businessId),
      this.repository.findShippedLines(projectId, businessId),
      this.repository.findManyByProject(projectId, businessId),
    ]);
    const billIds = shipments.flatMap((shipment) => (shipment.billId ? [shipment.billId] : []));
    const received = await this.repository.sumPaymentsByBill(billIds, businessId);
    const dtos = await Promise.all(
      shipments.map(async (shipment) => {
        const documents = await this.attachmentsService.listByEntity(SHIPMENT_ENTITY_TYPE, shipment.id);
        return toShipmentDto(
          shipment,
          shipment.billId ? (received.get(shipment.billId) ?? 0) : 0,
          await Promise.all(documents.map(toAttachmentDto)),
        );
      }),
    );
    return { lines: buildSupplyLines(clientLines, vendorLines, shipped), shipments: dtos };
  }

  /** Throws when the items exceed what the client PO still has left to ship. */
  private async assertQuantities(
    projectId: string,
    clientPurchaseOrderId: string,
    items: ShipmentItemInput[],
    businessId: string,
    exceptShipmentId?: string,
  ): Promise<void> {
    const [clientLines, shipped] = await Promise.all([
      this.repository.findClientPoLines(projectId, businessId),
      this.repository.findShippedLines(projectId, businessId),
    ]);
    const ordered = new Map(
      clientLines
        .filter((line) => line.clientPurchaseOrderId === clientPurchaseOrderId)
        .map((line) => [line.id, line]),
    );
    if (clientLines.every((line) => line.clientPurchaseOrderId !== clientPurchaseOrderId)) {
      throw new BadRequestError("That client PO is not on this project or has no lines");
    }
    const shippedElsewhere = new Map<string, number>();
    for (const line of shipped) {
      if (line.shipmentId === exceptShipmentId) continue;
      shippedElsewhere.set(line.clientPoItemId, (shippedElsewhere.get(line.clientPoItemId) ?? 0) + line.quantity);
    }
    const problem = shipmentQuantityProblem(items, ordered, shippedElsewhere);
    if (problem) throw new BadRequestError(problem);
  }

  private async log(actorId: string, action: string, shipment: { id: string; projectId: string; number: number }, context?: ScopedRequestContext, metadata: Record<string, unknown> = {}) {
    await this.auditService.log({
      actorId,
      action,
      entityType: "Project",
      entityId: shipment.projectId,
      metadata: { shipmentId: shipment.id, shipmentNumber: shipment.number, ...metadata },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
  }

  async create(projectId: string, input: CreateShipmentInput, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    await this.getProjectOrThrow(projectId, context.businessId);
    await this.assertQuantities(projectId, input.clientPurchaseOrderId, input.items, context.businessId);
    const id = await this.repository.create(
      {
        businessId: context.businessId,
        projectId,
        clientPurchaseOrderId: input.clientPurchaseOrderId,
        notes: input.notes ?? null,
        createdById: actorId,
      },
      input.items,
    );
    const shipment = await this.getOrThrow(id, context.businessId);
    await this.log(actorId, "SHIPMENT_CREATED", shipment, context);
    return this.toDto(shipment, context.businessId);
  }

  async update(id: string, input: UpdateShipmentInput, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    if (input.items) {
      this.assertStage(shipment, ["PREPARING"], "change its items");
      await this.assertQuantities(shipment.projectId, shipment.clientPurchaseOrderId, input.items, context.businessId, id);
    }
    await this.repository.update(
      id,
      {
        notes: input.notes,
        vehicleNumber: input.vehicleNumber,
        transporterName: input.transporterName,
        freightCost: input.freightCost,
      },
      input.items,
    );
    await this.log(actorId, "SHIPMENT_UPDATED", shipment, context);
    return this.getById(id, context.businessId);
  }

  async dispatch(id: string, input: DispatchShipmentInput, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    this.assertStage(shipment, ["PREPARING"], "be dispatched again");
    if (shipment.items.length === 0) throw new BadRequestError("Add items before dispatching");
    await this.repository.update(id, {
      ewayBillNumber: input.ewayBillNumber,
      ewayBillDate: new Date(input.ewayBillDate),
      dispatchedAt: input.dispatchedAt ? new Date(input.dispatchedAt) : new Date(),
      vehicleNumber: input.vehicleNumber,
      transporterName: input.transporterName,
      freightCost: input.freightCost,
    });
    await this.log(actorId, "SHIPMENT_DISPATCHED", shipment, context, { ewayBillNumber: input.ewayBillNumber });
    return this.getById(id, context.businessId);
  }

  async recordGrn(id: string, input: RecordShipmentGrnInput, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    this.assertStage(shipment, ["DISPATCHED", "GRN_RECEIVED"], "take a GRN");
    await this.repository.update(id, { grnNumber: input.grnNumber, grnDate: new Date(input.grnDate) });
    await this.log(actorId, "SHIPMENT_GRN_RECORDED", shipment, context, { grnNumber: input.grnNumber });
    return this.getById(id, context.businessId);
  }

  /** Raises the bill for the shipment through the Bills module, at the client PO rates. */
  async createBill(id: string, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    this.assertStage(shipment, ["GRN_RECEIVED"], "be billed");
    const project = await this.getProjectOrThrow(shipment.projectId, context.businessId);
    const bill = await this.billsService.createBill(
      {
        tenderId: project.tenderId,
        grnNumber: shipment.grnNumber ?? undefined,
        grnDate: shipment.grnDate?.toISOString(),
        items: shipment.items.map((item) => ({
          boqItemId: item.clientPoItem.boqItemId ?? undefined,
          description: item.clientPoItem.description,
          unit: item.clientPoItem.unit ?? undefined,
          quantity: item.quantity,
          rate: item.clientPoItem.rate,
        })),
      },
      actorId,
      context,
    );
    await this.repository.update(id, { billId: bill.id });
    await this.log(actorId, "SHIPMENT_BILLED", shipment, context, { billId: bill.id, billNumber: bill.billNumber });
    return this.getById(id, context.businessId);
  }

  async recordPayment(id: string, input: RecordShipmentPaymentInput, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    this.assertStage(shipment, ["BILLED"], "take a payment");
    const { settled, ...payment } = input;
    await this.financeService.recordBillPayment(shipment.billId!, payment, actorId, context.businessId);
    if (settled) await this.repository.update(id, { settledAt: new Date() });
    await this.log(actorId, "SHIPMENT_PAYMENT_RECORDED", shipment, context, { amount: input.amount, settled });
    return this.getById(id, context.businessId);
  }

  /**
   * Steps a shipment back one stage, for a mistake. A raised bill is not undone here: the bill
   * is its own record (with its own number) and is removed from the Bills page if it was wrong.
   */
  async undo(id: string, actorId: string, context: ScopedRequestContext): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, context.businessId);
    const stage = shipmentStage(shipment);
    const reset: Partial<Record<ShipmentStage, ShipmentFieldsData>> = {
      PAID: { settledAt: null },
      GRN_RECEIVED: { grnNumber: null, grnDate: null },
      DISPATCHED: { dispatchedAt: null },
    };
    const data = reset[stage];
    if (!data) throw new ConflictError(`Shipment ${shipment.number} is ${STAGE_LABEL[stage]}; there is no step to undo`);
    await this.repository.update(id, data);
    await this.log(actorId, "SHIPMENT_STAGE_UNDONE", shipment, context, { from: stage });
    return this.getById(id, context.businessId);
  }

  async delete(id: string, actorId: string, context: ScopedRequestContext): Promise<void> {
    const shipment = await this.getOrThrow(id, context.businessId);
    this.assertStage(shipment, ["PREPARING", "DISPATCHED"], "be deleted");
    const documents = await this.attachmentsService.listByEntity(SHIPMENT_ENTITY_TYPE, id);
    await Promise.all(documents.map((doc) => this.attachmentsService.deleteById(doc.id)));
    await this.repository.delete(id);
    await this.log(actorId, "SHIPMENT_DELETED", shipment, context);
  }

  async uploadDocument(
    id: string,
    file: { buffer: Buffer; originalName: string; mimeType: string },
    documentType: ShipmentDocumentType,
    actorId: string,
    businessId: string,
  ): Promise<ShipmentDto> {
    const shipment = await this.getOrThrow(id, businessId);
    await this.attachmentsService.upload({
      fileBuffer: file.buffer,
      originalName: file.originalName,
      declaredMimeType: file.mimeType,
      entityType: SHIPMENT_ENTITY_TYPE,
      entityId: id,
      uploadedById: actorId,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: false,
      documentType,
    });
    await this.log(actorId, "SHIPMENT_DOCUMENT_UPLOADED", shipment, undefined, { documentType, fileName: file.originalName });
    return this.getById(id, businessId);
  }
}
