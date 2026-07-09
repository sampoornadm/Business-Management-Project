import { randomUUID } from "node:crypto";

import type { BoqCompareDto, BoqCompareLineDto, BoqDto, BoqListItemDto, BoqParsePreviewDto } from "@bmp/types";

import { BOQ_UPLOAD_LIMITS } from "../../config/constants.js";
import { BadRequestError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import { round2 } from "../../shared/utils/math.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { sumItemAmounts, toBoqDto, toBoqListItemDto } from "./boq.mapper.js";
import { parseBoqFile } from "./boq.parser.js";
import type {
  CreateBoqItemRow,
  IBoqRepository,
  UpsertRateBreakdownData,
} from "./boq.repository.js";
import type {
  BulkUpdateBoqItemsBody,
  CommitBoqBody,
  CreateBoqItemBody,
  UpdateBoqItemBody,
  UpsertRateAnalysisBody,
} from "./boq.validation.js";

function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

export class BoqService {
  constructor(
    private readonly boqRepository: IBoqRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly attachmentsService: AttachmentsService,
    private readonly auditService: AuditService,
  ) {}

  private async assertTenderExists(tenderId: string): Promise<void> {
    const tender = await this.tendersRepository.findById(tenderId);
    if (!tender) throw new NotFoundError("Tender not found");
  }

  async parseUpload(
    tenderId: string,
    file: { buffer: Buffer; originalName: string; mimeType: string },
    actorId: string,
  ): Promise<BoqParsePreviewDto> {
    await this.assertTenderExists(tenderId);

    const { original } = await this.attachmentsService.upload({
      fileBuffer: file.buffer,
      originalName: file.originalName,
      declaredMimeType: file.mimeType,
      entityType: "Tender",
      entityId: tenderId,
      uploadedById: actorId,
      allowedMimeTypes: BOQ_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: BOQ_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: false,
      documentType: "BOQ",
    });

    const parsed = await parseBoqFile(file.buffer, original.mimeType);

    return {
      sourceAttachmentId: original.id,
      columns: parsed.columns,
      suggestedMapping: parsed.suggestedMapping,
      rows: parsed.rows,
    };
  }

  async commitBoq(
    tenderId: string,
    input: CommitBoqBody,
    actorId: string,
    context: RequestContext,
  ): Promise<BoqDto> {
    await this.assertTenderExists(tenderId);

    const boqId = randomUUID();
    let groupId: string;
    let version = 1;

    if (input.replacesBoqId) {
      const previous = await this.boqRepository.findBoqById(input.replacesBoqId);
      if (!previous || previous.tenderId !== tenderId) {
        throw new NotFoundError("BOQ version to replace was not found for this tender");
      }
      groupId = previous.groupId ?? previous.id;
      const versions = await this.boqRepository.findVersions(groupId);
      version = Math.max(1, ...versions.map((v) => v.version)) + 1;
    } else {
      // Version 1 of a fresh chain points groupId at its own id, mirroring
      // Attachment.documentGroupId — "all versions" is always `WHERE groupId = X`.
      groupId = boqId;
    }

    const idByTempId = new Map<string, string>();
    for (const item of input.items) idByTempId.set(item.tempId, randomUUID());

    for (const item of input.items) {
      if (item.parentTempId && !idByTempId.has(item.parentTempId)) {
        throw new BadRequestError(`Unknown parentTempId reference: ${item.parentTempId}`);
      }
    }

    const rows: CreateBoqItemRow[] = input.items.map((item, index) => {
      const quantity = item.quantity ?? null;
      const rate = item.rate ?? null;
      const amount = quantity !== null && rate !== null ? round2(quantity * rate) : null;
      const id = idByTempId.get(item.tempId);
      if (!id) throw new BadRequestError(`Duplicate tempId: ${item.tempId}`);
      return {
        id,
        parentId: item.parentTempId ? (idByTempId.get(item.parentTempId) ?? null) : null,
        itemCode: item.itemCode ?? null,
        description: item.description,
        category: item.category ?? null,
        unit: item.unit ?? null,
        quantity,
        rate,
        amount,
        remarks: item.remarks ?? null,
        sortOrder: item.sortOrder ?? index,
      };
    });

    await this.boqRepository.createBoq({
      id: boqId,
      tenderId,
      createdById: actorId,
      sourceAttachmentId: input.sourceAttachmentId ?? null,
      groupId,
      version,
      items: rows,
    });

    await this.auditService.log({
      actorId,
      action: "BOQ_COMMITTED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { boqId, version, itemCount: rows.length, ...context },
    });

    return this.buildBoqDto(boqId);
  }

  private async buildBoqDto(boqId: string): Promise<BoqDto> {
    const boq = await this.boqRepository.findBoqById(boqId);
    if (!boq) throw new NotFoundError("BOQ not found");
    const items = await this.boqRepository.findItemsByBoqId(boqId);
    return toBoqDto(boq, items);
  }

  async getCurrentBoq(tenderId: string): Promise<BoqDto> {
    await this.assertTenderExists(tenderId);
    const boq = await this.boqRepository.findCurrentBoq(tenderId);
    if (!boq) throw new NotFoundError("This tender has no BOQ yet");
    const items = await this.boqRepository.findItemsByBoqId(boq.id);
    return toBoqDto(boq, items);
  }

  async listVersions(tenderId: string): Promise<BoqListItemDto[]> {
    await this.assertTenderExists(tenderId);
    const current = await this.boqRepository.findCurrentBoq(tenderId);
    if (!current) return [];

    const groupId = current.groupId ?? current.id;
    const versions = await this.boqRepository.findVersions(groupId);
    const owned = versions.filter((v) => v.tenderId === tenderId);

    return Promise.all(
      owned.map(async (boq) => {
        const total = await this.boqRepository.sumAmountByBoqId(boq.id);
        return toBoqListItemDto(boq, total);
      }),
    );
  }

  async finalize(tenderId: string, actorId: string): Promise<BoqDto> {
    await this.assertTenderExists(tenderId);
    const boq = await this.boqRepository.findCurrentBoq(tenderId);
    if (!boq) throw new NotFoundError("This tender has no BOQ yet");
    await this.boqRepository.finalize(boq.id);
    await this.auditService.log({
      actorId,
      action: "BOQ_FINALIZED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { boqId: boq.id },
    });
    return this.getCurrentBoq(tenderId);
  }

  async updateItem(itemId: string, data: UpdateBoqItemBody, actorId: string): Promise<BoqDto> {
    const existing = await this.boqRepository.findItemById(itemId);
    if (!existing) throw new NotFoundError("BOQ item not found");

    const quantity = data.quantity !== undefined ? data.quantity : existing.quantity;
    const rate = data.rate !== undefined ? data.rate : existing.rate;
    const amount = quantity !== null && rate !== null ? round2(quantity * rate) : null;

    await this.boqRepository.updateItem(itemId, { ...data, amount });
    await this.auditService.log({
      actorId,
      action: "BOQ_ITEM_UPDATED",
      entityType: "BoqItem",
      entityId: itemId,
      metadata: { boqId: existing.boqId, changes: data },
    });
    return this.buildBoqDto(existing.boqId);
  }

  async addItem(tenderId: string, data: CreateBoqItemBody, actorId: string): Promise<BoqDto> {
    await this.assertTenderExists(tenderId);

    let boq = await this.boqRepository.findCurrentBoq(tenderId);
    if (!boq) {
      // A from-scratch tender (no document upload, no prior BOQ) still needs
      // somewhere for its first manually-added item to live — create an
      // empty version 1 rather than requiring the upload/commit flow first.
      const boqId = randomUUID();
      await this.boqRepository.createBoq({
        id: boqId,
        tenderId,
        createdById: actorId,
        sourceAttachmentId: null,
        groupId: boqId,
        version: 1,
        items: [],
      });
      boq = await this.boqRepository.findBoqById(boqId);
    }
    if (!boq) throw new NotFoundError("BOQ not found");

    const quantity = data.quantity ?? null;
    const rate = data.rate ?? null;
    const amount = quantity !== null && rate !== null ? round2(quantity * rate) : null;
    const existingItems = await this.boqRepository.findItemsByBoqId(boq.id);
    const nextSortOrder = existingItems.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;

    const item = await this.boqRepository.createItem({
      id: randomUUID(),
      boqId: boq.id,
      parentId: data.parentId ?? null,
      itemCode: data.itemCode ?? null,
      description: data.description,
      category: data.category ?? null,
      unit: data.unit ?? null,
      quantity,
      rate,
      amount,
      remarks: data.remarks ?? null,
      sortOrder: nextSortOrder,
    });

    await this.auditService.log({
      actorId,
      action: "BOQ_ITEM_ADDED",
      entityType: "BoqItem",
      entityId: item.id,
      metadata: { boqId: boq.id, description: data.description },
    });
    return this.buildBoqDto(boq.id);
  }

  async deleteItem(itemId: string, actorId: string): Promise<BoqDto> {
    const existing = await this.boqRepository.findItemById(itemId);
    if (!existing) throw new NotFoundError("BOQ item not found");

    await this.boqRepository.deleteItem(itemId);
    await this.auditService.log({
      actorId,
      action: "BOQ_ITEM_DELETED",
      entityType: "BoqItem",
      entityId: itemId,
      metadata: { boqId: existing.boqId, description: existing.description },
    });
    return this.buildBoqDto(existing.boqId);
  }

  async bulkUpdateItems(input: BulkUpdateBoqItemsBody, actorId: string): Promise<BoqDto> {
    const items = await this.boqRepository.findItemsByIds(input.itemIds);
    if (items.length !== input.itemIds.length) {
      throw new BadRequestError("One or more BOQ items were not found");
    }
    const boqId = items[0]!.boqId;
    if (items.some((item) => item.boqId !== boqId)) {
      throw new BadRequestError("All selected items must belong to the same BOQ");
    }

    const factor = 1 + input.ratePercentAdjustment / 100;
    const updates = items.map((item) => {
      const rate = item.rate !== null ? round2(item.rate * factor) : null;
      const amount = item.quantity !== null && rate !== null ? round2(item.quantity * rate) : null;
      return { id: item.id, rate, amount };
    });

    await this.boqRepository.bulkUpdateRates(updates);
    await this.auditService.log({
      actorId,
      action: "BOQ_ITEMS_BULK_UPDATED",
      entityType: "BoqItem",
      entityId: boqId,
      metadata: { itemIds: input.itemIds, ratePercentAdjustment: input.ratePercentAdjustment },
    });
    return this.buildBoqDto(boqId);
  }

  async upsertRateAnalysis(
    itemId: string,
    input: UpsertRateAnalysisBody,
    actorId: string,
  ): Promise<BoqDto> {
    const existing = await this.boqRepository.findItemById(itemId);
    if (!existing) throw new NotFoundError("BOQ item not found");

    const baseCost =
      input.materialCost + input.laborCost + input.machineryCost + input.transportCost;
    const computedRate = round2(
      baseCost *
        (1 + input.overheadPercent / 100) *
        (1 + input.profitPercent / 100) *
        (1 + input.taxPercent / 100),
    );

    const breakdown: UpsertRateBreakdownData = { ...input, computedRate };
    await this.boqRepository.upsertRateBreakdown(itemId, breakdown);

    const amount = existing.quantity !== null ? round2(existing.quantity * computedRate) : null;
    await this.boqRepository.updateItem(itemId, { rate: computedRate, amount });

    await this.auditService.log({
      actorId,
      action: "BOQ_ITEM_RATE_ANALYSIS_UPDATED",
      entityType: "BoqItem",
      entityId: itemId,
      metadata: { boqId: existing.boqId, computedRate },
    });
    return this.buildBoqDto(existing.boqId);
  }

  async compare(baseTenderId: string, compareTenderId: string): Promise<BoqCompareDto> {
    await this.assertTenderExists(baseTenderId);
    await this.assertTenderExists(compareTenderId);

    const [baseBoq, compareBoq] = await Promise.all([
      this.boqRepository.findCurrentBoq(baseTenderId),
      this.boqRepository.findCurrentBoq(compareTenderId),
    ]);
    if (!baseBoq) throw new NotFoundError("The base tender has no BOQ yet");
    if (!compareBoq) throw new NotFoundError("The comparison tender has no BOQ yet");

    const [baseItems, compareItems] = await Promise.all([
      this.boqRepository.findItemsByBoqId(baseBoq.id),
      this.boqRepository.findItemsByBoqId(compareBoq.id),
    ]);

    const compareByDescription = new Map(
      compareItems.map((item) => [normalizeDescription(item.description), item]),
    );
    const matchedIds = new Set<string>();
    const lines: BoqCompareLineDto[] = [];

    for (const item of baseItems) {
      const match = compareByDescription.get(normalizeDescription(item.description));
      if (match) matchedIds.add(match.id);
      lines.push({
        description: item.description,
        category: item.category,
        unit: item.unit,
        baseQuantity: item.quantity,
        baseRate: item.rate,
        baseAmount: item.amount,
        compareQuantity: match?.quantity ?? null,
        compareRate: match?.rate ?? null,
        compareAmount: match?.amount ?? null,
        rateDelta: item.rate !== null && match?.rate != null ? round2(match.rate - item.rate) : null,
        amountDelta:
          item.amount !== null && match?.amount != null ? round2(match.amount - item.amount) : null,
      });
    }

    for (const item of compareItems) {
      if (matchedIds.has(item.id)) continue;
      lines.push({
        description: item.description,
        category: item.category,
        unit: item.unit,
        baseQuantity: null,
        baseRate: null,
        baseAmount: null,
        compareQuantity: item.quantity,
        compareRate: item.rate,
        compareAmount: item.amount,
        rateDelta: null,
        amountDelta: null,
      });
    }

    return {
      baseTenderId,
      compareTenderId,
      lines,
      baseTotalAmount: sumItemAmounts(baseItems),
      compareTotalAmount: sumItemAmounts(compareItems),
    };
  }
}
