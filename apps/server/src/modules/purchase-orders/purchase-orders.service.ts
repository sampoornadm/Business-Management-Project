import type { PaginatedResult, PurchaseOrderDto, PurchaseOrderListItemDto } from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import { round2 } from "../../shared/utils/math.js";
import type { AuditService } from "../audit/audit.service.js";
import type { IRfqRepository } from "../rfq/rfq.repository.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";
import type { IVendorsRepository } from "../vendors/vendors.repository.js";

import { toPurchaseOrderDto, toPurchaseOrderListItemDto } from "./purchase-orders.mapper.js";
import type {
  CreatePurchaseOrderData,
  CreatePurchaseOrderItemData,
  IPurchaseOrdersRepository,
  PurchaseOrderDetail,
  PurchaseOrderFilters,
} from "./purchase-orders.repository.js";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateGoodsReceiptInput {
  receivedDate?: Date;
  remarks?: string;
  items: Array<{ purchaseOrderItemId: string; quantityReceived: number; remarks?: string }>;
}

export class PurchaseOrdersService {
  constructor(
    private readonly purchaseOrdersRepository: IPurchaseOrdersRepository,
    private readonly rfqRepository: IRfqRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly vendorsRepository: IVendorsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async getDetailOrThrow(id: string): Promise<PurchaseOrderDetail> {
    const po = await this.purchaseOrdersRepository.findById(id);
    if (!po) throw new NotFoundError("Purchase order not found");
    return po;
  }

  async listPurchaseOrders(
    pagination: PaginationParams,
    filters: PurchaseOrderFilters,
  ): Promise<PaginatedResult<PurchaseOrderListItemDto>> {
    const { items, totalItems } = await this.purchaseOrdersRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toPurchaseOrderListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<PurchaseOrderDto> {
    return toPurchaseOrderDto(await this.getDetailOrThrow(id));
  }

  async create(
    input: {
      vendorId: string;
      tenderId?: string;
      expectedDeliveryDate?: Date;
      notes?: string;
      items: Array<{ description: string; unit?: string; quantity: number; rate: number; sortOrder?: number }>;
    },
    actorId: string,
    context: RequestContext = {},
  ): Promise<PurchaseOrderDto> {
    if (input.items.length === 0) throw new BadRequestError("At least one purchase order item is required");

    const vendor = await this.vendorsRepository.findById(input.vendorId);
    if (!vendor) throw new BadRequestError("Invalid vendorId");
    if (input.tenderId) {
      const tender = await this.tendersRepository.findById(input.tenderId);
      if (!tender) throw new BadRequestError("Invalid tenderId");
    }

    const items: CreatePurchaseOrderItemData[] = input.items.map((item, index) => ({
      description: item.description,
      unit: item.unit ?? null,
      quantity: item.quantity,
      rate: item.rate,
      amount: round2(item.quantity * item.rate),
      sortOrder: item.sortOrder ?? index,
    }));

    const data: CreatePurchaseOrderData = {
      vendorId: input.vendorId,
      tenderId: input.tenderId ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      notes: input.notes ?? null,
      createdById: actorId,
      items,
    };
    const poId = await this.purchaseOrdersRepository.create(data);

    await this.auditService.log({
      actorId,
      action: "PURCHASE_ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: poId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(poId);
  }

  async createFromRfq(
    rfqId: string,
    options: { expectedDeliveryDate?: Date; notes?: string },
    actorId: string,
    context: RequestContext = {},
  ): Promise<PurchaseOrderDto> {
    const rfq = await this.rfqRepository.findById(rfqId);
    if (!rfq) throw new NotFoundError("RFQ not found");
    if (rfq.status !== "AWARDED" || !rfq.awardedVendorId) {
      throw new ConflictError("RFQ must be awarded to a vendor before creating a purchase order");
    }

    const awardedVendorId = rfq.awardedVendorId;
    const items: CreatePurchaseOrderItemData[] = rfq.items.map((item, index) => {
      const quote = item.quotes.find((q) => q.vendorId === awardedVendorId);
      if (!quote) {
        throw new BadRequestError(
          `The awarded vendor has not quoted a rate for item: ${item.description}`,
        );
      }
      return {
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        rate: quote.rate,
        amount: round2(item.quantity * quote.rate),
        sortOrder: index,
      };
    });

    const poId = await this.purchaseOrdersRepository.create({
      vendorId: awardedVendorId,
      tenderId: rfq.tenderId,
      sourceRfqId: rfq.id,
      expectedDeliveryDate: options.expectedDeliveryDate ?? null,
      notes: options.notes ?? null,
      createdById: actorId,
      items,
    });

    await this.auditService.log({
      actorId,
      action: "PURCHASE_ORDER_CREATED_FROM_RFQ",
      entityType: "PurchaseOrder",
      entityId: poId,
      metadata: { rfqId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(poId);
  }

  async updateStatus(
    id: string,
    status: "ISSUED" | "CANCELLED",
    actorId: string,
  ): Promise<PurchaseOrderDto> {
    const po = await this.getDetailOrThrow(id);

    if (status === "ISSUED" && po.status !== "DRAFT") {
      throw new ConflictError("Only a draft purchase order can be issued");
    }
    if (status === "CANCELLED" && !["DRAFT", "ISSUED"].includes(po.status)) {
      throw new ConflictError("Cannot cancel a purchase order once goods have been received");
    }

    await this.purchaseOrdersRepository.updateStatus(id, status);
    await this.auditService.log({
      actorId,
      action: `PURCHASE_ORDER_${status}`,
      entityType: "PurchaseOrder",
      entityId: id,
    });
    return this.getById(id);
  }

  async createGoodsReceipt(
    poId: string,
    input: CreateGoodsReceiptInput,
    actorId: string,
  ): Promise<PurchaseOrderDto> {
    const po = await this.getDetailOrThrow(poId);
    if (po.status !== "ISSUED" && po.status !== "PARTIALLY_RECEIVED") {
      throw new ConflictError("Purchase order must be issued before recording a goods receipt");
    }
    if (input.items.length === 0) throw new BadRequestError("At least one received item is required");

    const itemsById = new Map(po.items.map((item) => [item.id, item]));
    for (const receiptItem of input.items) {
      const poItem = itemsById.get(receiptItem.purchaseOrderItemId);
      if (!poItem) throw new BadRequestError(`Unknown purchase order item: ${receiptItem.purchaseOrderItemId}`);
      if (receiptItem.quantityReceived <= 0) throw new BadRequestError("quantityReceived must be positive");
      const projectedTotal = poItem.receivedQuantity + receiptItem.quantityReceived;
      if (projectedTotal > poItem.quantity + 1e-9) {
        throw new BadRequestError(
          `Received quantity for "${poItem.description}" would exceed the ordered quantity`,
        );
      }
    }

    await this.purchaseOrdersRepository.createGoodsReceipt({
      purchaseOrderId: poId,
      receivedById: actorId,
      receivedDate: input.receivedDate ?? new Date(),
      remarks: input.remarks,
      items: input.items,
    });

    const refreshed = await this.getDetailOrThrow(poId);
    const receivedById = new Map(input.items.map((i) => [i.purchaseOrderItemId, i.quantityReceived]));
    const allReceived = refreshed.items.every((item) => item.receivedQuantity >= item.quantity - 1e-9);
    const anyReceived =
      refreshed.items.some((item) => item.receivedQuantity > 1e-9) || receivedById.size > 0;
    const newStatus = allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : po.status;
    if (newStatus !== po.status) {
      await this.purchaseOrdersRepository.updateStatus(poId, newStatus);
    }

    await this.auditService.log({
      actorId,
      action: "GOODS_RECEIPT_RECORDED",
      entityType: "PurchaseOrder",
      entityId: poId,
      metadata: { items: input.items },
    });
    return this.getById(poId);
  }

  async upsertVendorRating(
    poId: string,
    input: { rating: number; remarks?: string },
    actorId: string,
  ): Promise<PurchaseOrderDto> {
    const po = await this.getDetailOrThrow(poId);
    if (po.status !== "RECEIVED") {
      throw new ConflictError("Can only rate a vendor once the purchase order is fully received");
    }

    await this.purchaseOrdersRepository.upsertVendorRating(
      poId,
      po.vendor.id,
      actorId,
      input.rating,
      input.remarks,
    );
    await this.auditService.log({
      actorId,
      action: "VENDOR_RATED",
      entityType: "PurchaseOrder",
      entityId: poId,
      metadata: { vendorId: po.vendor.id, rating: input.rating },
    });
    return this.getById(poId);
  }
}
