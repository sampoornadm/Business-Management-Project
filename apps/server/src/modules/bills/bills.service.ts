import type { BillDto, CreateBillInput } from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams, type PaginatedResult } from "../../core/interfaces/pagination.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { toBillDto, toBillListItemDto } from "./bills.mapper.js";
import type { BillDetail, IBillsRepository } from "./bills.repository.js";

export class BillsService {
  constructor(
    private readonly billsRepository: IBillsRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly auditService: AuditService,
  ) {}

  private async getDetailOrThrow(id: string, businessId: string): Promise<BillDetail> {
    const bill = await this.billsRepository.findById(id, businessId);
    if (!bill) throw new NotFoundError("Bill not found");
    return bill;
  }

  async listBills(
    pagination: PaginationParams,
    businessId: string,
  ): Promise<PaginatedResult<ReturnType<typeof toBillListItemDto>>> {
    const { items, totalItems } = await this.billsRepository.findMany(pagination, { businessId });
    return buildPaginatedResult(items.map(toBillListItemDto), totalItems, pagination);
  }

  async getById(id: string, businessId: string): Promise<BillDto> {
    return toBillDto(await this.getDetailOrThrow(id, businessId));
  }

  async createBill(
    input: CreateBillInput,
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<BillDto> {
    if (input.items.length === 0) throw new BadRequestError("At least one bill item is required");

    const tender = await this.tendersRepository.findForDocumentGeneration(input.tenderId, context.businessId);
    if (!tender) throw new BadRequestError("Invalid tenderId");
    if (tender.status !== "WON") {
      throw new ConflictError("Only a tender with status WON can be billed");
    }

    const billId = await this.billsRepository.create({
      businessId: context.businessId,
      tenderId: input.tenderId,
      grnNumber: input.grnNumber,
      grnDate: input.grnDate ? new Date(input.grnDate) : undefined,
      notes: input.notes,
      createdById: actorId,
      items: input.items,
    });

    await this.auditService.log({
      actorId,
      action: "BILL_CREATED",
      entityType: "Bill",
      entityId: billId,
      metadata: { tenderId: input.tenderId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.getById(billId, context.businessId);
  }
}
