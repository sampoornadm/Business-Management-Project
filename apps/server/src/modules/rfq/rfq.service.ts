import type {
  ContactDto,
  InviteVendorPreviewDto,
  ItemPriceHistoryDto,
  PaginatedResult,
  RecommendedVendorDto,
  RfqComparisonDto,
  RfqComparisonItemDto,
  RfqComparisonVendorTotalDto,
  RfqDto,
  RfqListItemDto,
  RfqVendorSuggestionsDto,
  RfqVendorSuggestionsPerItemDto,
  SuggestedVendorDto,
} from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { ScopedRequestContext } from "../../core/interfaces/request-context.js";
import type { EmailService } from "../../infra/mailer/email.service.js";
import { round2 } from "../../shared/utils/math.js";
import type { AuditService } from "../audit/audit.service.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";
import type { ContactsService } from "../contacts/contacts.service.js";
import type { IHistoricalRatesRepository } from "../rates/rates.repository.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";
import type { IUsersRepository } from "../users/users.repository.js";
import type { IVendorsRepository } from "../vendors/vendors.repository.js";

import { buildQuoteSheet, parseQuoteSheet } from "./quote-sheet.js";
import { buildRfrDocx, buildRfrPdf, toRfrDocumentData } from "./rfq-document.js";
import { toItemPriceHistoryDto, toRfqDto, toRfqListItemDto } from "./rfq.mapper.js";
import type {
  CreateRfqData,
  IRfqRepository,
  ItemPriceFilters,
  RfqDetail,
  RfqFilters,
  UpdateRfqData,
} from "./rfq.repository.js";

const FINALIZED_STATUSES = new Set(["CLOSED", "CANCELLED"]);

export class RfqService {
  constructor(
    private readonly rfqRepository: IRfqRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly vendorsRepository: IVendorsRepository,
    private readonly boqRepository: IBoqRepository,
    private readonly usersRepository: IUsersRepository,
    private readonly businessesRepository: IBusinessesRepository,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
    private readonly ratesRepository: IHistoricalRatesRepository,
    private readonly contactsService: ContactsService,
  ) {}

  private async getDetailOrThrow(id: string, businessId: string): Promise<RfqDetail> {
    const rfq = await this.rfqRepository.findById(id, businessId);
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

  async getById(id: string, businessId: string): Promise<RfqDto> {
    return toRfqDto(await this.getDetailOrThrow(id, businessId));
  }

  async listItemPrices(
    pagination: PaginationParams,
    filters: ItemPriceFilters,
  ): Promise<PaginatedResult<ItemPriceHistoryDto>> {
    const { items, totalItems } = await this.rfqRepository.listItemPrices(pagination, filters);
    const boqItemIds = [
      ...new Set(items.map((i) => i.rfqItem.boqItemId).filter((id): id is string => Boolean(id))),
    ];
    const categories = await this.rfqRepository.findBoqItemCategories(boqItemIds);
    const categoryById = new Map(categories.map((c) => [c.id, c.category]));
    return buildPaginatedResult(
      items.map((row) =>
        toItemPriceHistoryDto(
          row,
          row.rfqItem.boqItemId ? categoryById.get(row.rfqItem.boqItemId) ?? null : null,
        ),
      ),
      totalItems,
      pagination,
    );
  }

  async create(
    input: Omit<CreateRfqData, "createdById" | "businessId"> & { vendorIds?: string[] },
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<RfqDto> {
    if (input.items.length === 0) throw new BadRequestError("At least one RFQ item is required");
    if (input.tenderId) {
      // RFQs can be standalone (no tenderId), so businessId is always sourced
      // from context — never derived from the tender, even when one is given.
      const tender = await this.tendersRepository.findById(input.tenderId, context.businessId);
      if (!tender) throw new BadRequestError("Invalid tenderId");
    }

    const { vendorIds, ...createData } = input;
    const rfqId = await this.rfqRepository.create({
      ...createData,
      businessId: context.businessId,
      createdById: actorId,
    });

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
    return this.getById(rfqId, context.businessId);
  }

  async update(id: string, data: UpdateRfqData, actorId: string, businessId: string): Promise<RfqDto> {
    await this.getDetailOrThrow(id, businessId);
    await this.rfqRepository.update(id, data);
    await this.auditService.log({ actorId, action: "RFQ_UPDATED", entityType: "Rfq", entityId: id });
    return this.getById(id, businessId);
  }

  async addVendorInvite(
    rfqId: string,
    vendorId: string,
    actorId: string,
    businessId: string,
  ): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
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
    return this.getById(rfqId, businessId);
  }

  async removeVendorInvite(
    rfqId: string,
    vendorId: string,
    actorId: string,
    businessId: string,
  ): Promise<RfqDto> {
    // Ownership must be checked first — otherwise a vendorId that legitimately
    // belongs to an rfqId from another business would still be mutated before
    // the final getById() below ever gets a chance to reject it.
    await this.getDetailOrThrow(rfqId, businessId);
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
    return this.getById(rfqId, businessId);
  }

  async upsertQuote(
    rfqItemId: string,
    vendorId: string,
    input: {
      rate?: number;
      regretted?: boolean;
      make?: string;
      model?: string;
      quotedAt?: Date;
      remarks?: string;
    },
    actorId: string,
    businessId: string,
  ): Promise<RfqDto> {
    const item = await this.rfqRepository.findItemById(rfqItemId);
    if (!item) throw new NotFoundError("RFQ item not found");

    // RfqItem has no businessId column of its own — getDetailOrThrow scopes
    // through the parent Rfq immediately below, before anything is mutated.
    const rfq = await this.getDetailOrThrow(item.rfqId, businessId);
    if (FINALIZED_STATUSES.has(rfq.status)) {
      throw new ConflictError("Cannot record quotes on a finalized RFQ");
    }
    const invite = rfq.vendorInvites.find((v) => v.vendor.id === vendorId);
    if (!invite) throw new BadRequestError("Vendor was not invited to this RFQ");

    const regretted = input.regretted === true;
    // Zod's refine guards the HTTP boundary; this guards every direct caller too, so a
    // meaningless quote (no rate, no regret) is never persisted as a rate-null non-regret.
    if (!regretted && input.rate === undefined) {
      throw new BadRequestError("Provide a rate, or mark the item as regretted");
    }

    await this.rfqRepository.upsertQuote(rfqItemId, vendorId, {
      rate: regretted ? null : (input.rate ?? null),
      regretted,
      make: input.make,
      model: input.model,
      quotedAt: input.quotedAt,
      remarks: input.remarks,
    });
    if (invite.status === "INVITED") {
      await this.rfqRepository.updateVendorInviteStatus(item.rfqId, vendorId, "RESPONDED");
    }

    // Auto-select the lowest non-regretted quote, but only while nothing has
    // been explicitly selected yet for this item — an explicit human choice
    // (via selectQuote) always wins over a later, cheaper quote. Re-fetched
    // fresh (not the `rfq`/item above) because those were read before the
    // upsert just above and don't reflect the quote we just wrote.
    const freshRfq = await this.rfqRepository.findRfqByItemId(rfqItemId, businessId);
    const freshItem = freshRfq?.items.find((i) => i.id === rfqItemId);
    if (freshItem && !freshItem.quotes.some((q) => q.isSelected)) {
      const cheapest = freshItem.quotes
        .filter((q) => !q.regretted && q.rate !== null)
        .sort((a, b) => a.rate! - b.rate!)[0];
      if (cheapest) await this.rfqRepository.selectQuote(rfqItemId, cheapest.id);
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTE_RECORDED",
      entityType: "Rfq",
      entityId: item.rfqId,
      metadata: { rfqItemId, vendorId, rate: input.rate ?? null, regretted },
    });
    return this.getById(item.rfqId, businessId);
  }

  async buildQuoteSheetFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildQuoteSheet(data);
    return { filename: `quotes-${safeTitle || rfqId}.xlsx`, buffer };
  }

  private async loadRfrDocumentData(rfqId: string, businessId: string) {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const business = await this.businessesRepository.findById(businessId);
    if (!business) throw new NotFoundError("Business not found");

    let tenderNumber: string | null = null;
    if (rfq.tenderId) {
      const tender = await this.tendersRepository.findById(rfq.tenderId, businessId);
      tenderNumber = tender?.tenderNumber ?? null;
    }

    const data = toRfrDocumentData(rfq, business, tenderNumber);
    const safeTitle = rfq.title.replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60);
    return { data, safeTitle };
  }

  async buildRfrPdfFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildRfrPdf(data);
    return { filename: `RFR-${safeTitle || rfqId}.pdf`, buffer };
  }

  async buildRfrDocxFor(rfqId: string, businessId: string): Promise<{ filename: string; buffer: Buffer }> {
    const { data, safeTitle } = await this.loadRfrDocumentData(rfqId, businessId);
    const buffer = await buildRfrDocx(data);
    return { filename: `RFR-${safeTitle || rfqId}.docx`, buffer };
  }

  async importQuotes(
    rfqId: string,
    vendorId: string,
    buffer: Buffer,
    actorId: string,
    businessId: string,
  ): Promise<{ imported: number; errors: string[] }> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    if (FINALIZED_STATUSES.has(rfq.status)) {
      throw new ConflictError("Cannot record quotes on a finalized RFQ");
    }
    const invite = rfq.vendorInvites.find((v) => v.vendor.id === vendorId);
    if (!invite) throw new BadRequestError("Vendor was not invited to this RFQ");

    const { rows, errors } = await parseQuoteSheet(buffer);
    // Only ids that belong to THIS rfq. A sheet from another RFQ must not write here.
    const ownItemIds = new Set(rfq.items.map((i) => i.id));

    let imported = 0;
    for (const row of rows) {
      if (!ownItemIds.has(row.rfqItemId)) {
        errors.push(`${row.rfqItemId} is not an item on this RFQ`);
        continue;
      }
      await this.rfqRepository.upsertQuote(row.rfqItemId, vendorId, {
        rate: row.rate,
        regretted: row.regretted,
        make: row.make,
        model: row.model,
        remarks: row.remarks,
      });
      imported += 1;
    }

    if (imported > 0 && invite.status === "INVITED") {
      await this.rfqRepository.updateVendorInviteStatus(rfqId, vendorId, "RESPONDED");
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTES_IMPORTED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId, imported, errorCount: errors.length },
    });

    return { imported, errors };
  }

  async getComparison(rfqId: string, businessId: string): Promise<RfqComparisonDto> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);

    const vendorTotals = new Map<string, { vendorName: string; total: number; itemsQuoted: number }>();
    const items: RfqComparisonItemDto[] = rfq.items.map((item) => {
      // Regretted rows carry no rate. They must not reach Math.min: a null coerces to 0 and
      // the vendor who declined the line would be reported as the cheapest bid on it.
      const priced = item.quotes.filter((q) => !q.regretted && q.rate !== null);
      const rates = priced.map((q) => q.rate as number);
      const lowestRate = rates.length > 0 ? Math.min(...rates) : null;

      const quotes = item.quotes.map((quote) => {
        const isPriced = !quote.regretted && quote.rate !== null;
        const amount = isPriced ? round2((quote.rate as number) * item.quantity) : null;

        if (isPriced) {
          const existing = vendorTotals.get(quote.vendor.id) ?? {
            vendorName: quote.vendor.name,
            total: 0,
            itemsQuoted: 0,
          };
          existing.total = round2(existing.total + (amount as number));
          existing.itemsQuoted += 1;
          vendorTotals.set(quote.vendor.id, existing);
        } else {
          // Still register the vendor so a wholly-regretting vendor appears with a zero total
          // rather than vanishing from the comparison.
          if (!vendorTotals.has(quote.vendor.id)) {
            vendorTotals.set(quote.vendor.id, {
              vendorName: quote.vendor.name,
              total: 0,
              itemsQuoted: 0,
            });
          }
        }

        return {
          vendorId: quote.vendor.id,
          vendorName: quote.vendor.name,
          rate: quote.rate,
          amount,
          isLowest: isPriced && quote.rate === lowestRate,
          regretted: quote.regretted,
          make: quote.make,
          model: quote.model,
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

  async selectQuote(
    rfqId: string,
    rfqItemId: string,
    quoteId: string,
    actorId: string,
    businessId: string,
  ): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const item = rfq.items.find((i) => i.id === rfqItemId);
    if (!item) throw new BadRequestError("Item does not belong to this RFQ");
    const quote = item.quotes.find((q) => q.id === quoteId);
    if (!quote) throw new BadRequestError("Quote does not belong to this item");

    await this.rfqRepository.selectQuote(rfqItemId, quoteId);
    await this.auditService.log({
      actorId,
      action: "RFQ_QUOTE_SELECTED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { rfqItemId, quoteId },
    });
    return this.getById(rfqId, businessId);
  }

  async close(rfqId: string, actorId: string, businessId: string): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    if (FINALIZED_STATUSES.has(rfq.status)) throw new ConflictError("RFQ is already finalized");

    await this.rfqRepository.updateStatus(rfqId, "CLOSED");
    await this.auditService.log({ actorId, action: "RFQ_CLOSED", entityType: "Rfq", entityId: rfqId });
    return this.getById(rfqId, businessId);
  }

  // Reopening a finalized (CLOSED/CANCELLED) RFQ goes back to SENT if vendors were already
  // invited, else DRAFT — mirroring how the RFQ got to SENT in the first place (see
  // addVendorInvite below). There's no "award" to clear: awards are now per-item quote
  // selections, not a whole-RFQ status.
  async reopen(rfqId: string, actorId: string, context: ScopedRequestContext): Promise<RfqDto> {
    const rfq = await this.getDetailOrThrow(rfqId, context.businessId);
    if (!FINALIZED_STATUSES.has(rfq.status)) {
      throw new BadRequestError("RFQ is not finalized — nothing to reopen");
    }

    const nextStatus = rfq.vendorInvites.length > 0 ? "SENT" : "DRAFT";
    await this.rfqRepository.reopen(rfqId, nextStatus);
    await this.auditService.log({
      actorId,
      action: "RFQ_REOPENED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { from: rfq.status, to: nextStatus },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(rfqId, context.businessId);
  }

  // v1: plain substring keyword matching against the live VendorItemTag
  // vocabulary (no ML/embeddings) — ranked by how many of the *selected*
  // items each vendor can cover, with vendors whose tagged `make` also
  // appears in the item text ordered first. See the vendor-matching plan
  // (async-humming-cosmos.md) for why this is deliberately simple for v1.
  async suggestVendors(boqItemIds: string[], businessId: string): Promise<RfqVendorSuggestionsDto> {
    if (boqItemIds.length === 0) return { perItem: [], recommended: [] };

    const items = await this.boqRepository.findItemsByIds(boqItemIds, businessId);
    const itemTypes = await this.vendorsRepository.findDistinctItemTypes();
    const matches = itemTypes.length > 0 ? await this.vendorsRepository.findActiveVendorsByItemTypes(itemTypes) : [];

    const coverageByVendor = new Map<string, { name: string; itemIds: Set<string> }>();
    const perItem: RfqVendorSuggestionsPerItemDto[] = items.map((item) => {
      const text = item.description.toLowerCase();
      const matchedItemTypes = itemTypes.filter((type) => text.includes(type.toLowerCase()));

      const candidates = matches
        .filter((match) => matchedItemTypes.includes(match.itemType))
        .sort((a, b) => {
          const aMakeHit = a.make ? text.includes(a.make.toLowerCase()) : false;
          const bMakeHit = b.make ? text.includes(b.make.toLowerCase()) : false;
          return Number(bMakeHit) - Number(aMakeHit);
        });

      const suggestedVendors: SuggestedVendorDto[] = [];
      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (seen.has(candidate.vendorId)) continue;
        seen.add(candidate.vendorId);
        suggestedVendors.push({
          vendorId: candidate.vendorId,
          name: candidate.vendorName,
          itemType: candidate.itemType,
        });

        const entry = coverageByVendor.get(candidate.vendorId) ?? {
          name: candidate.vendorName,
          itemIds: new Set<string>(),
        };
        entry.itemIds.add(item.id);
        coverageByVendor.set(candidate.vendorId, entry);
      }

      return { boqItemId: item.id, suggestedVendors };
    });

    const recommended: RecommendedVendorDto[] = [...coverageByVendor.entries()]
      .map(([vendorId, { name, itemIds }]) => ({ vendorId, name, coverageCount: itemIds.size }))
      .sort((a, b) => b.coverageCount - a.coverageCount);

    return { perItem, recommended };
  }

  private async loadInviteVendorContext(rfqId: string, vendorId: string, businessId: string) {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new BadRequestError("Vendor not found");
    const contacts = await this.contactsService.listContacts("VENDOR", vendorId);
    const contactEmail = this.pickPrimaryContactEmail(contacts);
    if (!contactEmail) {
      throw new BadRequestError("This vendor has no contact email on file — add one first");
    }
    return { rfq, vendor, contactEmail };
  }

  private pickPrimaryContactEmail(contacts: ContactDto[]): string | undefined {
    const primaryContact = contacts.find((c) => c.isPrimary) ?? contacts[0];
    const primaryEmail = primaryContact?.emails.find((e) => e.isPrimary) ?? primaryContact?.emails[0];
    return primaryEmail?.email;
  }

  // Preview only — nothing is persisted. The returned text is what the user
  // reviews/edits before inviteVendor() actually sends it.
  async previewInviteVendor(
    rfqId: string,
    input: { vendorId: string },
    businessId: string,
  ): Promise<InviteVendorPreviewDto> {
    const { rfq, contactEmail } = await this.loadInviteVendorContext(rfqId, input.vendorId, businessId);
    const text = `You are invited to quote for RFQ "${rfq.title}"${
      rfq.tenderId ? " (tender-linked)" : ""
    }. Please review the attached item list and respond with your best rates.`;
    return { text, vendorContactEmail: contactEmail };
  }

  // Invites a vendor to an EXISTING RFQ (unlike the old quickSend, which
  // always created a brand-new one) and emails the exact text the user ended
  // up with after editing the preview — the server never regenerates it here.
  async inviteVendor(
    rfqId: string,
    input: { vendorId: string; text: string },
    actorId: string,
    context: ScopedRequestContext,
  ): Promise<RfqDto> {
    const { rfq, contactEmail } = await this.loadInviteVendorContext(rfqId, input.vendorId, context.businessId);

    const alreadyInvited = await this.rfqRepository.findVendorInvite(rfqId, input.vendorId);
    if (!alreadyInvited) {
      await this.rfqRepository.addVendorInvite(rfqId, input.vendorId);
      await this.rfqRepository.updateStatus(rfqId, "SENT");
    }

    await this.emailService.queueRfqEmail({ to: contactEmail, rfqTitle: rfq.title, bodyText: input.text });
    await this.auditService.log({
      actorId,
      action: "RFQ_VENDOR_INVITED",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { vendorId: input.vendorId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(rfqId, context.businessId);
  }

  // Only closed RFQs are final enough to trust: an item's selected quote is
  // pushed onto its linked BOQ item's rate and recorded as a historical rate
  // (via rates.repository#recordFromRfqQuote, Task 7's transactional isDefault
  // flip). Items with no boqItemId (standalone RFQ lines) or no selected/priced
  // quote are silently skipped, not errors — a partial RFQ still pushes what it can.
  async pushRatesToTender(
    rfqId: string,
    actorId: string,
    businessId: string,
  ): Promise<{ updatedItems: number }> {
    const rfq = await this.getDetailOrThrow(rfqId, businessId);
    if (rfq.status !== "CLOSED") {
      throw new ConflictError("RFQ must be closed before pushing rates to the tender");
    }

    // amount is a stored column (quantity × rate), not derived on read — every other
    // rate-writing path (BoqService.updateItem/addItem/bulkUpdateItems) recomputes and
    // persists it alongside rate. Batch-fetch quantities once, not once per item.
    const boqItemIds = rfq.items.map((item) => item.boqItemId).filter((id): id is string => Boolean(id));
    const boqItems = await this.boqRepository.findItemsByIds(boqItemIds, businessId);
    const quantityByBoqItemId = new Map(boqItems.map((boqItem) => [boqItem.id, boqItem.quantity]));

    let updatedItems = 0;
    for (const item of rfq.items) {
      if (!item.boqItemId) continue;
      // boqItemId is client-supplied at RFQ-creation time with only UUID-format validation (no
      // ownership check) and BoqRepository#updateItem has no business filter — the batch fetch
      // above IS the business-scope check. `.has()` (not `.get() ?? null`) because a real BOQ
      // item can legitimately have a null quantity; only "absent from the map" means "didn't
      // resolve for this business," and that's what must be skipped, not written to.
      if (!quantityByBoqItemId.has(item.boqItemId)) continue;
      const selected = item.quotes.find((q) => q.isSelected);
      if (!selected || selected.rate === null) continue;

      const quantity = quantityByBoqItemId.get(item.boqItemId) ?? null;
      const amount = quantity !== null ? round2(quantity * selected.rate) : null;
      await this.boqRepository.updateItem(item.boqItemId, { rate: selected.rate, amount });
      await this.ratesRepository.recordFromRfqQuote({
        businessId,
        itemName: item.description,
        unit: item.unit ?? "unit",
        rate: selected.rate,
        vendorId: selected.vendor.id,
        rfqQuoteId: selected.id,
        sourceTenderId: rfq.tenderId,
        createdById: actorId,
      });
      updatedItems += 1;
    }

    await this.auditService.log({
      actorId,
      action: "RFQ_RATES_PUSHED_TO_TENDER",
      entityType: "Rfq",
      entityId: rfqId,
      metadata: { updatedItems },
    });
    return { updatedItems };
  }
}
