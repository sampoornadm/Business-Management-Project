import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { BoqLine } from "../client-purchase-orders.checks.js";
import { flagPoLine, matchBoqLine } from "../client-purchase-orders.checks.js";
import type {
  ClientPoData,
  ClientPoItemData,
  ClientPurchaseOrderWithItems,
  IClientPurchaseOrdersRepository,
  ProjectForClientPo,
} from "../client-purchase-orders.repository.js";
import { ClientPurchaseOrdersService } from "../client-purchase-orders.service.js";

const BUSINESS = "business-1";
const BOQ: BoqLine[] = [
  { id: "boq-cable", itemCode: "1234567890", description: "XLPE cable 4C x 16 sq mm", unit: "Mtr", quantity: 100, rate: 250 },
  { id: "boq-gland", itemCode: null, description: "Cable gland 25 mm", unit: "Nos", quantity: 20, rate: 40 },
  { id: "boq-lug", itemCode: null, description: "Copper lug 16 sq mm", unit: "Nos", quantity: 50, rate: 12 },
];

class FakeRepository implements IClientPurchaseOrdersRepository {
  project: ProjectForClientPo = { id: "project-1", tenderId: "tender-1", deliveryPeriodDays: 120, wonItems: [] };
  orders: ClientPurchaseOrderWithItems[] = [];

  async findProject(projectId: string, businessId: string) {
    return projectId === this.project.id && businessId === BUSINESS ? this.project : null;
  }
  async findCurrentBoqLines() {
    return BOQ;
  }
  async findManyByProject(projectId: string) {
    return this.orders.filter((order) => order.projectId === projectId);
  }
  async findById(id: string, businessId: string) {
    return this.orders.find((order) => order.id === id && order.businessId === businessId) ?? null;
  }
  async findByPoNumber(poNumber: string, businessId: string) {
    return this.orders.find((order) => order.poNumber === poNumber && order.businessId === businessId) ?? null;
  }
  async create(
    data: ClientPoData & { businessId: string; projectId: string; createdById: string },
    items: ClientPoItemData[],
  ) {
    const id = `po-${this.orders.length + 1}`;
    this.orders.push({
      ...data,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: { id: data.createdById, firstName: "Test", lastName: "User" },
      items: items.map((item, index) => ({ ...item, id: `${id}-item-${index}`, clientPurchaseOrderId: id })),
    });
    return id;
  }
  async update(id: string, data: Partial<ClientPoData>, items?: ClientPoItemData[]) {
    const order = this.orders.find((row) => row.id === id)!;
    Object.assign(order, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
    if (items) order.items = items.map((item, index) => ({ ...item, id: `${id}-item-${index}`, clientPurchaseOrderId: id }));
  }
  async delete(id: string) {
    this.orders = this.orders.filter((order) => order.id !== id);
  }
  shipped = new Map<string, number>();
  async shippedQuantityByItem() {
    return this.shipped;
  }
}

describe("client PO checks", () => {
  it("flags rate, quantity and unit differences, and lines not in the BOQ", () => {
    const cable = BOQ[0]!;
    expect(flagPoLine({ boqItemId: cable.id, unit: "Meter", quantity: 100, rate: 250 }, cable, 100)).toEqual([]);
    expect(flagPoLine({ boqItemId: cable.id, unit: "Mtr", quantity: 100, rate: 240 }, cable, 100)).toEqual(["RATE_MISMATCH"]);
    expect(flagPoLine({ boqItemId: cable.id, unit: "Mtr", quantity: 60, rate: 250 }, cable, 120)).toEqual(["QTY_ABOVE_BOQ"]);
    expect(flagPoLine({ boqItemId: cable.id, unit: "Kg", quantity: 1, rate: 250 }, cable, 1)).toEqual(["UNIT_MISMATCH"]);
    expect(flagPoLine({ boqItemId: null, unit: null, quantity: 1, rate: 1 }, undefined, 0)).toEqual(["NOT_IN_BOQ"]);
  });

  it("matches a PO line by item code first, then by description", () => {
    expect(matchBoqLine({ itemCode: "12345 67890", description: "anything" }, BOQ)?.id).toBe("boq-cable");
    expect(matchBoqLine({ description: "CABLE GLAND, 25 MM" }, BOQ)?.id).toBe("boq-gland");
    expect(matchBoqLine({ description: "Something else" }, BOQ)).toBeUndefined();
  });
});

describe("ClientPurchaseOrdersService", () => {
  let repository: FakeRepository;
  let service: ClientPurchaseOrdersService;
  let generateJson: ReturnType<typeof vi.fn>;
  let extractText: ReturnType<typeof vi.fn>;
  const context = { businessId: BUSINESS };

  beforeEach(() => {
    repository = new FakeRepository();
    generateJson = vi.fn();
    extractText = vi.fn();
    service = new ClientPurchaseOrdersService(
      repository,
      { listByEntity: vi.fn().mockResolvedValue([]), deleteById: vi.fn() } as unknown as AttachmentsService,
      { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      generateJson,
      extractText,
    );
  });

  it("defaults the delivery due date to the PO date plus the tender's delivery period", async () => {
    const order = await service.create(
      "project-1",
      { poNumber: "PO-1", poDate: "2026-11-01", items: [{ boqItemId: "boq-cable", description: "Cable", quantity: 10, rate: 250 }] },
      "user-1",
      context,
    );
    expect(order.deliveryDueDate.slice(0, 10)).toBe("2027-03-01");
    expect(order.poValue).toBe(2500);
  });

  it("rejects a PO number that is already recorded", async () => {
    const input = { poNumber: "PO-1", poDate: "2026-11-01", items: [{ description: "Cable", quantity: 1, rate: 1 }] };
    await service.create("project-1", input, "user-1", context);
    await expect(service.create("project-1", input, "user-1", context)).rejects.toThrow("already recorded");
  });

  it("checks split POs together and lists priced BOQ lines nobody ordered", async () => {
    await service.create(
      "project-1",
      { poNumber: "PO-1", poDate: "2026-11-01", deliveryDueDate: "2027-01-15", items: [{ boqItemId: "boq-cable", description: "Cable", unit: "Mtr", quantity: 70, rate: 250 }] },
      "user-1",
      context,
    );
    await service.create(
      "project-1",
      { poNumber: "PO-2", poDate: "2026-11-05", deliveryDueDate: "2026-12-31", items: [{ boqItemId: "boq-cable", description: "Cable", unit: "Mtr", quantity: 40, rate: 245 }] },
      "user-1",
      context,
    );

    const result = await service.listForProject("project-1", BUSINESS);
    expect(result.orders.map((order) => order.items[0]!.flags)).toEqual([["QTY_ABOVE_BOQ"], ["RATE_MISMATCH", "QTY_ABOVE_BOQ"]]);
    expect(result.unorderedBoqItems.map((line) => line.boqItemId)).toEqual(["boq-gland", "boq-lug"]);
    expect(result.totalValue).toBe(70 * 250 + 40 * 245);
    expect(result.earliestDueDate?.slice(0, 10)).toBe("2026-12-31");
  });

  it("expects only the won lines on a partly won tender", async () => {
    repository.project.wonItems = [
      { boqItemId: "boq-lug", itemCode: null, description: "Copper lug 16 sq mm", unit: "Nos", quantity: 50, rate: 12, amount: 600 },
    ];
    const result = await service.listForProject("project-1", BUSINESS);
    expect(result.unorderedBoqItems.map((line) => line.boqItemId)).toEqual(["boq-lug"]);
  });

  it("reads a PO document into a draft priced at our rates and compares the document total", async () => {
    const table = [
      "Item Code\tDescription\tQty\tUOM",
      "1234567890\tXLPE cable 4C x 16 sq mm\t80\tMtr",
      "\tTerminal block 4 way\t5\tNos",
    ].join("\n");
    extractText.mockResolvedValue(table);
    generateJson.mockResolvedValue({ poNumber: "4500001234", poDate: "2026-11-10", deliveryPeriodDays: 90, totalValue: 30000 });

    const draft = await service.extract(
      "project-1",
      Buffer.from("x"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      BUSINESS,
    );

    expect(draft.poNumber).toBe("4500001234");
    expect(draft.deliveryDueDate).toBe("2027-02-08");
    expect(draft.items[0]).toMatchObject({ boqItemId: "boq-cable", quantity: 80, rate: 250 });
    expect(draft.items[1]).toMatchObject({ boqItemId: null, rate: 0 });
    expect(draft.warnings.some((warning) => warning.includes("did not match"))).toBe(true);
    expect(draft.warnings.some((warning) => warning.includes("differs"))).toBe(true);
  });

  it("still returns the item draft when the model's reply is unusable", async () => {
    extractText.mockResolvedValue("nothing tabular here");
    generateJson.mockResolvedValue("not json");
    const draft = await service.extract("project-1", Buffer.from("x"), "application/pdf", BUSINESS);
    expect(draft.poNumber).toBeUndefined();
    expect(draft.items).toEqual([]);
    expect(draft.warnings).toHaveLength(2);
  });
});
