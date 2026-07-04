import type {
  PaginatedResult,
  RfqComparisonDto,
  RfqComparisonItemDto,
  RfqComparisonVendorTotalDto,
  RfqDto,
  RfqListItemDto,
} from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import { round2 } from "../../shared/utils/math.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";
import type { IVendorsRepository } from "../vendors/vendors.repository.js";

import { toRfqDto, toRfqListItemDto } from "./rfq.mapper.js";
import type { CreateRfqData, IRfqRepository, RfqDetail, RfqFilters, UpdateRfqData } from "./rfq.repository.js";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

const FINALIZED_STATUSES = new Set(["AWARDED", "CLOSED", "CANCELLED"]);

export class RfqService {
  constructor(
    private readonly rfqRepository: IRfqRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly vendorsRepository: IVendorsRepository,
    private readonly auditService: AuditService,
  ) {}

  private async getDetailOrThrow(id: string): Promise<RfqDetail> {
    const rfq = await this.rfqRepository.findById(id);
    if (!rfq) throw new NotFoundError("RFQ not found");
    return rfq;
  }

  async listRfqs(
    pagination: PaginationParams,
    filters: RfqFilters,
  ): Promise<PaginatedResult<RfqListItemDto>> {
    const { items, totalItems } = await this.rfqRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toRfqListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<RfqDto> {
    return toRfqDto(await this.getDetailOrThrow(id));
  }

  async create(
    input: Omit<CreateRfqData, "createdById"> & { vendorIds?: string[] },
    actorId: string,
    context: RequestContext = {},
  ): Promise<RfqDto> {
    if (input.items.length === 0) throw new BadRequestError("At least one RFQ item is required");
    if (input.tenderId) {
      const tender = await this.tendersRepository.findById(input.tenderId);
      if (!tender) throw new BadRequestError("Invalid tenderId");
    }

    const { vendorIds, ...createData } = input;
    const rfqId = await this.rfqRepository.create({ ...createData, createdById: actorId });

    if (vendorIds && vendorIds.length > 0) {
      for (const vendorId of vendorIds) {
        const vendor = await this.vendorsRepository.findById(vendorId);
        if (!vendor) throw new BadRequestError(`Invalid vendor: ${vendorId}`);
        await this.rfqRepository.addVendorInvite(rfqId, vendorId);
      }
      await this.rfqRepository.updateStatus(rfqId, "SENT");
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_CREATED",
      entityType: "Rfq",
      entityId: rfqId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(rfqId);
  }

  async update(id: string, data: UpdateRfqData, actorId: string): Promise<RfqDto> {
    await this.getDetailOrThrow(id);
    await this.rfqRepository.update(id, data);
    await this.auditService.log({ actorId, action: "RFQ_UPDATED", entityType: "Rfq", entityId: id });
    return this.getById(id);
  }

  async addVendorInvite(rfqId: string, vendorId: string, actorId: string): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId);
    if (FINALIZED_STATUSES.has(rfq.status)) {
      throw new ConflictError("Cannot invite vendors to a finalized RFQ");
    }
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new BadRequestError("Vendor not found");

    const existing = await this.rfqRepository.findVendorInvite(rfqId, vendorId);
    if (existing) throw new ConflictError("Vendor is already invited to this RFQ");

    await this.rfqRepository.addVendorInvite(rfqId, vendorId);
    if (rfq.status === "DRAFT") await this.rfqRepository.updateStatus(rfqId, "SENT");

    await this.auditService.log({
      actorId,
      action: "RFQ_VENDOR_INVITED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId },
    });
    return this.getById(rfqId);
  }

  async removeVendorInvite(rfqId: string, vendorId: string, actorId: string): Promise<RfqDto> {
    const existing = await this.rfqRepository.findVendorInvite(rfqId, vendorId);
    if (!existing) throw new NotFoundError("Vendor invite not found for this RFQ");

    await this.rfqRepository.removeVendorInvite(rfqId, vendorId);
    await this.auditService.log({
      actorId,
      action: "RFQ_VENDOR_REMOVED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId },
    });
    return this.getById(rfqId);
  }

  async upsertQuote(
    rfqItemId: string,
    vendorId: string,
    input: { rate: number; remarks?: string },
    actorId: string,
  ): Promise<RfqDto> {
    const item = await this.rfqRepository.findItemById(rfqItemId);
    if (!item) throw new NotFoundError("RFQ item not found");

    const rfq = await this.getDetailOrThrow(item.rfqId);
    if (FINALIZED_STATUSES.has(rfq.status)) {
      throw new ConflictError("Cannot record quotes on a finalized RFQ");
    }
    const invite = rfq.vendorInvites.find((v) => v.vendor.id === vendorId);
    if (!invite) throw new BadRequestError("Vendor was not invited to this RFQ");

    await this.rfqRepository.upsertQuote(rfqItemId, vendorId, input.rate, input.remarks);
    if (invite.status === "INVITED") {
      await this.rfqRepository.updateVendorInviteStatus(item.rfqId, vendorId, "RESPONDED");
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTE_RECORDED",
      entityType: "Rfq",
      entityId: item.rfqId,
      metadata: { rfqItemId, vendorId, rate: input.rate },
    });
    return this.getById(item.rfqId);
  }

  async getComparison(rfqId: string): Promise<RfqComparisonDto> {
    const rfq = await this.getDetailOrThrow(rfqId);

    const vendorTotals = new Map<string, { vendorName: string; total: number; itemsQuoted: number }>();
    const items: RfqComparisonItemDto[] = rfq.items.map((item) => {
      const rates = item.quotes.map((q) => q.rate);
      const lowestRate = rates.length > 0 ? Math.min(...rates) : null;

      const quotes = item.quotes.map((quote) => {
        const amount = round2(quote.rate * item.quantity);
        const existing = vendorTotals.get(quote.vendor.id) ?? {
          vendorName: quote.vendor.name,
          total: 0,
          itemsQuoted: 0,
        };
        existing.total = round2(existing.total + amount);
        existing.itemsQuoted += 1;
        vendorTotals.set(quote.vendor.id, existing);

        return {
          vendorId: quote.vendor.id,
          vendorName: quote.vendor.name,
          rate: quote.rate,
          amount,
          isLowest: quote.rate === lowestRate,
        };
      });

      return {
        itemId: item.id,
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        quotes,
      };
    });

    const totals: RfqComparisonVendorTotalDto[] = [...vendorTotals.entries()]
      .map(([vendorId, v]) => ({ vendorId, vendorName: v.vendorName, total: v.total, itemsQuoted: v.itemsQuoted }))
      .sort((a, b) => a.total - b.total);

    return { rfqId, items, vendorTotals: totals };
  }

  async award(rfqId: string, vendorId: string, actorId: string): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId);
    if (FINALIZED_STATUSES.has(rfq.status)) throw new ConflictError("RFQ is already finalized");
    if (!rfq.vendorInvites.some((v) => v.vendor.id === vendorId)) {
      throw new BadRequestError("Vendor was not invited to this RFQ");
    }

    await this.rfqRepository.setAwardedVendor(rfqId, vendorId);
    await this.auditService.log({
      actorId,
      action: "RFQ_AWARDED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId },
    });
    return this.getById(rfqId);
  }

  async close(rfqId: string, actorId: string): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId);
    if (FINALIZED_STATUSES.has(rfq.status)) throw new ConflictError("RFQ is already finalized");

    await this.rfqRepository.updateStatus(rfqId, "CLOSED");
    await this.auditService.log({ actorId, action: "RFQ_CLOSED", entityType: "Rfq", entityId: rfqId });
    return this.getById(rfqId);
  }
}
