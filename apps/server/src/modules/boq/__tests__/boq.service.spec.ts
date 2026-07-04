import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type {
  BoqItemWithBreakdown,
  BoqWithCreator,
  BulkRateUpdate,
  CreateBoqData,
  IBoqRepository,
  UpdateBoqItemData,
  UpsertRateBreakdownData,
} from "../boq.repository.js";
import { BoqService } from "../boq.service.js";

const CREATOR = { id: randomUUID(), firstName: "Emma", lastName: "Estimator" };

class FakeBoqRepository implements IBoqRepository {
  boqs = new Map<string, BoqWithCreator>();
  items = new Map<string, BoqItemWithBreakdown>();

  async createBoq(data: CreateBoqData): Promise<void> {
    for (const boq of this.boqs.values()) {
      if (boq.tenderId === data.tenderId) boq.isCurrent = false;
    }
    this.boqs.set(data.id, {
      id: data.id,
      tenderId: data.tenderId,
      sourceAttachmentId: data.sourceAttachmentId,
      groupId: data.groupId,
      version: data.version,
      isCurrent: true,
      status: "DRAFT",
      createdById: data.createdById,
      createdBy: CREATOR,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as BoqWithCreator);

    for (const item of data.items) {
      this.items.set(item.id, {
        ...item,
        boqId: data.id,
        rateBreakdown: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as BoqItemWithBreakdown);
    }
  }

  async findBoqById(id: string) {
    return this.boqs.get(id) ?? null;
  }

  async findCurrentBoq(tenderId: string) {
    return [...this.boqs.values()].find((b) => b.tenderId === tenderId && b.isCurrent) ?? null;
  }

  async findVersions(groupId: string) {
    return [...this.boqs.values()]
      .filter((b) => (b.groupId ?? b.id) === groupId)
      .sort((a, b) => b.version - a.version);
  }

  async findItemsByBoqId(boqId: string) {
    return [...this.items.values()]
      .filter((item) => item.boqId === boqId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async findItemById(id: string) {
    return this.items.get(id) ?? null;
  }

  async findItemsByIds(ids: string[]) {
    return ids.map((id) => this.items.get(id)).filter((item): item is BoqItemWithBreakdown => Boolean(item));
  }

  async updateItem(id: string, data: UpdateBoqItemData) {
    const item = this.items.get(id);
    if (!item) throw new Error("not found");
    Object.assign(item, data);
  }

  async bulkUpdateRates(updates: BulkRateUpdate[]) {
    for (const update of updates) {
      const item = this.items.get(update.id);
      if (!item) continue;
      item.rate = update.rate;
      item.amount = update.amount;
    }
  }

  async upsertRateBreakdown(itemId: string, data: UpsertRateBreakdownData) {
    const item = this.items.get(itemId);
    if (!item) throw new Error("not found");
    item.rateBreakdown = {
      id: randomUUID(),
      boqItemId: itemId,
      ...data,
      updatedAt: new Date(),
    } as unknown as BoqItemWithBreakdown["rateBreakdown"];
  }

  async sumAmountByBoqId(boqId: string) {
    return [...this.items.values()]
      .filter((item) => item.boqId === boqId)
      .reduce((sum, item) => sum + (item.amount ?? 0), 0);
  }

  async finalize(boqId: string) {
    const boq = this.boqs.get(boqId);
    if (boq) boq.status = "FINALIZED";
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenderIds = new Set<string>();

  async findById(id: string) {
    return this.tenderIds.has(id) ? ({ id } as never) : null;
  }
}

describe("BoqService", () => {
  let boqRepository: FakeBoqRepository;
  let tendersRepository: FakeTendersRepository;
  let attachmentsService: AttachmentsService;
  let auditService: AuditService;
  let service: BoqService;
  const tenderId = randomUUID();
  const actorId = randomUUID();

  beforeEach(() => {
    boqRepository = new FakeBoqRepository();
    tendersRepository = new FakeTendersRepository();
    tendersRepository.tenderIds.add(tenderId);
    attachmentsService = { upload: vi.fn() } as unknown as AttachmentsService;
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new BoqService(
      boqRepository as unknown as IBoqRepository,
      tendersRepository as unknown as ITendersRepository,
      attachmentsService,
      auditService,
    );
  });

  it("rejects operating on an unknown tender", async () => {
    await expect(
      service.commitBoq(randomUUID(), { items: [{ tempId: "1", description: "Row" }] }, actorId, {}),
    ).rejects.toThrow(NotFoundError);
  });

  it("commits a BOQ and builds a nested item tree with server-computed amounts", async () => {
    const boq = await service.commitBoq(
      tenderId,
      {
        items: [
          { tempId: "cat-1", description: "Earthwork", category: "Civil" },
          { tempId: "item-1", parentTempId: "cat-1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 },
        ],
      },
      actorId,
      {},
    );

    expect(boq.version).toBe(1);
    expect(boq.items).toHaveLength(1);
    const category = boq.items[0]!;
    expect(category.description).toBe("Earthwork");
    expect(category.amount).toBeNull();
    expect(category.children).toHaveLength(1);
    const leaf = category.children[0]!;
    expect(leaf.amount).toBe(5000);
    expect(boq.totalAmount).toBe(5000);
  });

  it("rejects a commit that references an unknown parentTempId", async () => {
    await expect(
      service.commitBoq(
        tenderId,
        { items: [{ tempId: "1", parentTempId: "ghost", description: "Orphan" }] },
        actorId,
        {},
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("creates a new version on replacesBoqId, incrementing the version and superseding the old one", async () => {
    const first = await service.commitBoq(
      tenderId,
      { items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 }] },
      actorId,
      {},
    );

    const second = await service.commitBoq(
      tenderId,
      {
        replacesBoqId: first.id,
        items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 55 }],
      },
      actorId,
      {},
    );

    expect(second.version).toBe(2);
    expect(second.isCurrent).toBe(true);

    const versions = await service.listVersions(tenderId);
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.id === first.id)?.isCurrent).toBe(false);
    expect(versions.find((v) => v.id === second.id)?.isCurrent).toBe(true);

    const current = await service.getCurrentBoq(tenderId);
    expect(current.id).toBe(second.id);
  });

  it("bulk-updates rates by a percentage adjustment and recomputes amounts", async () => {
    const boq = await service.commitBoq(
      tenderId,
      {
        items: [
          { tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 },
          { tempId: "2", description: "Backfilling", unit: "cum", quantity: 40, rate: 20 },
        ],
      },
      actorId,
      {},
    );
    const itemIds = boq.items.map((item) => item.id);

    const updated = await service.bulkUpdateItems({ itemIds, ratePercentAdjustment: 10 }, actorId);

    const excavation = updated.items.find((item) => item.description === "Excavation")!;
    expect(excavation.rate).toBe(55);
    expect(excavation.amount).toBe(5500);
    const backfilling = updated.items.find((item) => item.description === "Backfilling")!;
    expect(backfilling.rate).toBe(22);
    expect(backfilling.amount).toBe(880);
  });

  it("rejects a bulk update referencing an unknown item id", async () => {
    await expect(
      service.bulkUpdateItems({ itemIds: [randomUUID()], ratePercentAdjustment: 5 }, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("computes a rate from the cost breakdown and applies it back to the item", async () => {
    const boq = await service.commitBoq(
      tenderId,
      { items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 10 }] },
      actorId,
      {},
    );
    const itemId = boq.items[0]!.id;

    const updated = await service.upsertRateAnalysis(
      itemId,
      {
        materialCost: 100,
        laborCost: 50,
        machineryCost: 0,
        transportCost: 0,
        overheadPercent: 10,
        profitPercent: 10,
        taxPercent: 0,
      },
      actorId,
    );

    const item = updated.items[0]!;
    // (100 + 50) * 1.10 * 1.10 = 181.5
    expect(item.rateBreakdown?.computedRate).toBe(181.5);
    expect(item.rate).toBe(181.5);
    expect(item.amount).toBe(1815);
  });

  it("compares the current BOQs of two tenders by matching description", async () => {
    const otherTenderId = randomUUID();
    tendersRepository.tenderIds.add(otherTenderId);

    await service.commitBoq(
      tenderId,
      { items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 }] },
      actorId,
      {},
    );
    await service.commitBoq(
      otherTenderId,
      { items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 60 }] },
      actorId,
      {},
    );

    const comparison = await service.compare(tenderId, otherTenderId);
    expect(comparison.lines).toHaveLength(1);
    expect(comparison.lines[0]!.rateDelta).toBe(10);
    expect(comparison.lines[0]!.amountDelta).toBe(1000);
    expect(comparison.baseTotalAmount).toBe(5000);
    expect(comparison.compareTotalAmount).toBe(6000);
  });

  it("parses an uploaded Excel BOQ into a preview with a suggested column mapping", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("BOQ");
    sheet.addRow(["Item Code", "Description", "Unit", "Quantity", "Rate"]);
    sheet.addRow(["1.1", "Excavation", "cum", 100, 50]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    attachmentsService.upload = vi.fn().mockResolvedValue({
      original: {
        id: "attachment-1",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });

    const preview = await service.parseUpload(
      tenderId,
      {
        buffer,
        originalName: "boq.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      actorId,
    );

    expect(preview.sourceAttachmentId).toBe("attachment-1");
    expect(preview.suggestedMapping.description).toBe("Description");
    expect(preview.suggestedMapping.quantity).toBe("Quantity");
    expect(preview.suggestedMapping.rate).toBe("Rate");
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]!.cells["Quantity"]).toBe(100);
  });
});
