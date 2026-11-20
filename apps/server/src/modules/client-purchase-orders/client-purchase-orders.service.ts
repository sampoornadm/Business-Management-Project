import type {
  AttachmentDto,
  ClientPurchaseOrderDto,
  ClientPurchaseOrderExtractionDto,
  ClientPurchaseOrderItemInput,
  CreateClientPurchaseOrderInput,
  ProjectClientPurchaseOrdersDto,
  UpdateClientPurchaseOrderInput,
} from "@bmp/types";
import { z } from "zod";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import { round2 } from "../../shared/utils/math.js";
import { toAttachmentDto } from "../attachments/attachments.mapper.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ExtractTextFn, GenerateJsonFn } from "../tenders/tender-extraction.service.js";
import { parseIiscoRfqItems } from "../tenders/tender-item.parser.js";
import { parseTabularItems } from "../tenders/tender-table-items.parser.js";

import {
  type BoqLine,
  matchBoqLine,
  orderedQuantityByBoqItem,
  unorderedLines,
} from "./client-purchase-orders.checks.js";
import { type ClientPoCheckContext, toClientPurchaseOrderDto } from "./client-purchase-orders.mapper.js";
import type {
  ClientPoItemData,
  ClientPurchaseOrderWithItems,
  IClientPurchaseOrdersRepository,
  ProjectForClientPo,
} from "./client-purchase-orders.repository.js";

export const CLIENT_PO_ENTITY_TYPE = "ClientPurchaseOrder";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_PROMPT_CHARS = 12_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const headerSchema = z.object({
  poNumber: z.string().nullish(),
  poDate: z.string().nullish(),
  deliveryDate: z.string().nullish(),
  deliveryPeriodDays: z.coerce.number().nullish(),
  totalValue: z.coerce.number().nullish(),
});

const HEADER_PROMPT = `You are reading a purchase order (PO) that a client sent to its supplier.
Return ONLY a single JSON object (no markdown, no explanation) with exactly these keys:
- "poNumber": the purchase order number, exactly as printed
- "poDate": the PO date as YYYY-MM-DD
- "deliveryDate": the date by which delivery must be completed, as YYYY-MM-DD, if a date is stated
- "deliveryPeriodDays": the delivery period in days from the PO date, if a period is stated instead of a date
- "totalValue": the PO's total value as a plain number (no currency symbol, no commas)
Use null for anything the document does not state. Do not guess.

Document text:
"""
`;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function toItemData(items: ClientPurchaseOrderItemInput[]): ClientPoItemData[] {
  return items.map((item, index) => ({
    id: item.id,
    boqItemId: item.boqItemId ?? null,
    itemCode: item.itemCode ?? null,
    description: item.description,
    unit: item.unit ?? null,
    quantity: item.quantity,
    rate: item.rate,
    sortOrder: index,
  }));
}

/** Lines the client was expected to order: the won lines if any, else every priced BOQ leaf. */
function expectedLines(project: ProjectForClientPo, boqLines: BoqLine[]): BoqLine[] {
  if (project.wonItems.length === 0) return boqLines.filter((line) => line.rate !== null);
  return project.wonItems.map((won) => ({
    id: won.boqItemId,
    itemCode: won.itemCode,
    description: won.description,
    unit: won.unit,
    quantity: won.quantity,
    rate: won.rate,
  }));
}

export class ClientPurchaseOrdersService {
  constructor(
    private readonly repository: IClientPurchaseOrdersRepository,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
    private readonly generateJson: GenerateJsonFn,
    private readonly extractText: ExtractTextFn,
  ) {}

  private async getProjectOrThrow(projectId: string, businessId: string): Promise<ProjectForClientPo> {
    const project = await this.repository.findProject(projectId, businessId);
    if (!project) throw new NotFoundError("Project not found");
    return project;
  }

  private async getOrderOrThrow(id: string, businessId: string): Promise<ClientPurchaseOrderWithItems> {
    const order = await this.repository.findById(id, businessId);
    if (!order) throw new NotFoundError("Client purchase order not found");
    return order;
  }

  private async documentsFor(orderId: string): Promise<AttachmentDto[]> {
    const rows = await this.attachmentsService.listByEntity(CLIENT_PO_ENTITY_TYPE, orderId);
    return Promise.all(rows.map(toAttachmentDto));
  }

  private async checkContext(
    project: ProjectForClientPo,
    businessId: string,
  ): Promise<{ boqLines: BoqLine[]; orders: ClientPurchaseOrderWithItems[]; context: ClientPoCheckContext }> {
    const [boqLines, orders] = await Promise.all([
      this.repository.findCurrentBoqLines(project.tenderId, businessId),
      this.repository.findManyByProject(project.id, businessId),
    ]);
    const context = {
      boqById: new Map(boqLines.map((line) => [line.id, line])),
      orderedQuantity: orderedQuantityByBoqItem(orders.flatMap((order) => order.items)),
    };
    return { boqLines, orders, context };
  }

  async listForProject(projectId: string, businessId: string): Promise<ProjectClientPurchaseOrdersDto> {
    const project = await this.getProjectOrThrow(projectId, businessId);
    const { boqLines, orders, context } = await this.checkContext(project, businessId);
    const dtos = await Promise.all(
      orders.map(async (order) => toClientPurchaseOrderDto(order, context, await this.documentsFor(order.id))),
    );
    const dueDates = orders.map((order) => order.deliveryDueDate.getTime());
    return {
      orders: dtos,
      unorderedBoqItems: unorderedLines(expectedLines(project, boqLines), new Set(context.orderedQuantity.keys())),
      totalValue: round2(dtos.reduce((sum, order) => sum + order.poValue, 0)),
      earliestDueDate: dueDates.length ? new Date(Math.min(...dueDates)).toISOString() : null,
    };
  }

  async getById(id: string, businessId: string): Promise<ClientPurchaseOrderDto> {
    const order = await this.getOrderOrThrow(id, businessId);
    const project = await this.getProjectOrThrow(order.projectId, businessId);
    const { context } = await this.checkContext(project, businessId);
    return toClientPurchaseOrderDto(order, context, await this.documentsFor(id));
  }

  private async assertPoNumberFree(poNumber: string, businessId: string, exceptId?: string): Promise<void> {
    const existing = await this.repository.findByPoNumber(poNumber, businessId);
    if (existing && existing.id !== exceptId) {
      throw new ConflictError(`Client PO ${poNumber} is already recorded`);
    }
  }

  async create(
    projectId: string,
    input: CreateClientPurchaseOrderInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<ClientPurchaseOrderDto> {
    const project = await this.getProjectOrThrow(projectId, context.businessId);
    await this.assertPoNumberFree(input.poNumber, context.businessId);

    const poDate = new Date(input.poDate);
    const id = await this.repository.create(
      {
        businessId: context.businessId,
        projectId,
        createdById: actorId,
        poNumber: input.poNumber,
        poDate,
        deliveryDueDate: input.deliveryDueDate
          ? new Date(input.deliveryDueDate)
          : addDays(poDate, project.deliveryPeriodDays),
        notes: input.notes ?? null,
      },
      toItemData(input.items),
    );

    await this.auditService.log({
      actorId,
      action: "CLIENT_PO_CREATED",
      entityType: "Project",
      entityId: projectId,
      metadata: { clientPurchaseOrderId: id, poNumber: input.poNumber },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(id, context.businessId);
  }

  async update(
    id: string,
    input: UpdateClientPurchaseOrderInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<ClientPurchaseOrderDto> {
    const order = await this.getOrderOrThrow(id, context.businessId);
    if (input.poNumber && input.poNumber !== order.poNumber) {
      await this.assertPoNumberFree(input.poNumber, context.businessId, id);
    }
    if (input.items) {
      const shipped = await this.repository.shippedQuantityByItem(id);
      for (const [itemId, quantity] of shipped) {
        const kept = input.items.find((item) => item.id === itemId);
        const line = order.items.find((item) => item.id === itemId);
        if (!kept) throw new ConflictError(`"${line?.description ?? "A line"}" has been shipped and cannot be removed`);
        if (kept.quantity < quantity) {
          throw new ConflictError(`"${kept.description}" cannot go below the ${quantity} already shipped`);
        }
      }
    }
    await this.repository.update(
      id,
      {
        poNumber: input.poNumber,
        poDate: input.poDate ? new Date(input.poDate) : undefined,
        deliveryDueDate: input.deliveryDueDate ? new Date(input.deliveryDueDate) : undefined,
        notes: input.notes,
      },
      input.items ? toItemData(input.items) : undefined,
    );
    await this.auditService.log({
      actorId,
      action: "CLIENT_PO_UPDATED",
      entityType: "Project",
      entityId: order.projectId,
      metadata: { clientPurchaseOrderId: id, poNumber: input.poNumber ?? order.poNumber },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(id, context.businessId);
  }

  async delete(id: string, actorId: string, context: ScopedRequestContext): Promise<void> {
    const order = await this.getOrderOrThrow(id, context.businessId);
    if ((await this.repository.shippedQuantityByItem(id)).size > 0) {
      throw new ConflictError("This PO has shipments; delete them first");
    }
    const documents = await this.attachmentsService.listByEntity(CLIENT_PO_ENTITY_TYPE, id);
    await Promise.all(documents.map((doc) => this.attachmentsService.deleteById(doc.id)));
    await this.repository.delete(id);
    await this.auditService.log({
      actorId,
      action: "CLIENT_PO_DELETED",
      entityType: "Project",
      entityId: order.projectId,
      metadata: { clientPurchaseOrderId: id, poNumber: order.poNumber },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async uploadDocument(
    id: string,
    file: { buffer: Buffer; originalName: string; mimeType: string },
    actorId: string,
    businessId: string,
  ): Promise<ClientPurchaseOrderDto> {
    const order = await this.getOrderOrThrow(id, businessId);
    await this.attachmentsService.upload({
      fileBuffer: file.buffer,
      originalName: file.originalName,
      declaredMimeType: file.mimeType,
      entityType: CLIENT_PO_ENTITY_TYPE,
      entityId: id,
      uploadedById: actorId,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: false,
    });
    await this.auditService.log({
      actorId,
      action: "CLIENT_PO_DOCUMENT_UPLOADED",
      entityType: "Project",
      entityId: order.projectId,
      metadata: { clientPurchaseOrderId: id, fileName: file.originalName },
    });
    return this.getById(id, businessId);
  }

  /**
   * Reads a client PO document into a draft for the form; nothing is saved. Header fields come
   * from the local model; item lines come from the same deterministic table parsers the tender
   * upload uses, linked to our BOQ and priced at our quoted rate so the user only fixes the
   * lines where the client's rate differs. The document's own total is compared with the items.
   */
  async extract(
    projectId: string,
    buffer: Buffer,
    mimeType: string,
    businessId: string,
  ): Promise<ClientPurchaseOrderExtractionDto> {
    const project = await this.getProjectOrThrow(projectId, businessId);
    const boqLines = await this.repository.findCurrentBoqLines(project.tenderId, businessId);
    const warnings: string[] = [];

    const text = await this.extractText(buffer, mimeType);
    const itemsText = await this.extractText(buffer, mimeType, { layout: true });
    // ponytail: these parsers were written for tender documents. A PO laid out differently
    // yields no lines and the user adds them by hand; add a PO-specific parser once real
    // client POs show their shape.
    let parsedItems = parseIiscoRfqItems(itemsText);
    if (parsedItems.length === 0 && mimeType !== "application/pdf") parsedItems = parseTabularItems(itemsText);

    const items: ClientPurchaseOrderItemInput[] = parsedItems.map((parsed) => {
      const boqLine = matchBoqLine(parsed, boqLines);
      return {
        boqItemId: boqLine?.id ?? null,
        itemCode: parsed.itemCode ?? boqLine?.itemCode ?? null,
        description: parsed.description,
        unit: parsed.unit ?? boqLine?.unit ?? null,
        quantity: parsed.quantity ?? boqLine?.quantity ?? 0,
        rate: boqLine?.rate ?? 0,
      };
    });
    if (items.length === 0) warnings.push("No item lines were found in the document. Add them by hand.");
    const unmatched = items.filter((item) => !item.boqItemId).length;
    if (unmatched > 0) {
      warnings.push(`${unmatched} line(s) did not match a line of our BOQ. Pick the BOQ line or check them.`);
    }

    const parsed = headerSchema.safeParse(await this.generateJson(`${HEADER_PROMPT}${text.slice(0, MAX_PROMPT_CHARS)}\n"""`));
    if (!parsed.success) {
      warnings.push("The model's response did not match the expected format, so the PO number and dates were not read.");
      return { items, warnings };
    }
    const header = parsed.data;
    const poDate = header.poDate && ISO_DATE.test(header.poDate) ? header.poDate : undefined;
    let deliveryDueDate = header.deliveryDate && ISO_DATE.test(header.deliveryDate) ? header.deliveryDate : undefined;
    if (!deliveryDueDate && poDate && header.deliveryPeriodDays) {
      deliveryDueDate = addDays(new Date(poDate), header.deliveryPeriodDays).toISOString().slice(0, 10);
    }

    const documentTotal = header.totalValue ?? undefined;
    const itemsTotal = round2(items.reduce((sum, item) => sum + item.quantity * item.rate, 0));
    if (documentTotal !== undefined && items.length > 0 && Math.abs(documentTotal - itemsTotal) > 1) {
      warnings.push(
        `The document's total (${documentTotal}) differs from the lines at our quoted rates (${itemsTotal}). It may include GST or freight; otherwise check the rates.`,
      );
    }

    return {
      poNumber: header.poNumber ?? undefined,
      poDate,
      deliveryDueDate,
      documentTotal,
      items,
      warnings,
    };
  }
}
