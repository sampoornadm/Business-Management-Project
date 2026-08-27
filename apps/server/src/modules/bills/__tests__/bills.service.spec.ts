import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { BadRequestError, ConflictError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ITendersRepository, TenderForDocumentGeneration } from "../../tenders/tenders.repository.js";
import type { BillDetail, BillFilters, BillListItem, CreateBillData, IBillsRepository } from "../bills.repository.js";
import { BillsService } from "../bills.service.js";

const CREATOR = { id: randomUUID(), firstName: "Priya", lastName: "Accounts" };

class FakeBillsRepository implements IBillsRepository {
  bills = new Map<string, BillDetail>();

  async create(data: CreateBillData) {
    const id = randomUUID();
    const bill: BillDetail = {
      id,
      businessId: data.businessId,
      tenderId: data.tenderId,
      billNumber: `BILL-${id.slice(0, 8).toUpperCase()}`,
      billDate: new Date(),
      grnNumber: data.grnNumber ?? null,
      grnDate: data.grnDate ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      tender: { id: data.tenderId, title: "Test Tender", tenderNumber: "TND-1", client: { name: "IISCO" } },
      items: data.items.map((item, index) => ({
        id: randomUUID(),
        billId: id,
        boqItemId: item.boqItemId ?? null,
        description: item.description,
        unit: item.unit ?? null,
        quantity: item.quantity,
        rate: item.rate,
        sortOrder: item.sortOrder ?? index,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as BillDetail;
    this.bills.set(id, bill);
    return id;
  }

  async findById(id: string, _businessId: string) {
    return this.bills.get(id) ?? null;
  }

  async findMany(_pagination: unknown, _filters: BillFilters) {
    const items = [...this.bills.values()] as unknown as BillListItem[];
    return { items, totalItems: items.length };
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenders = new Map<string, TenderForDocumentGeneration>();

  async findForDocumentGeneration(id: string, _businessId: string) {
    return this.tenders.get(id) ?? null;
  }
}

describe("BillsService", () => {
  let repository: FakeBillsRepository;
  let tendersRepository: FakeTendersRepository;
  let auditService: AuditService;
  let service: BillsService;
  const actorId = randomUUID();
  const businessId = randomUUID();
  const tenderId = randomUUID();
  const context = { businessId, ipAddress: "127.0.0.1", userAgent: "vitest" };

  beforeEach(() => {
    repository = new FakeBillsRepository();
    tendersRepository = new FakeTendersRepository();
    auditService = { log: async () => {} } as unknown as AuditService;
    service = new BillsService(
      repository as unknown as IBillsRepository,
      tendersRepository as unknown as ITendersRepository,
      auditService,
    );
  });

  function seedTender(status: "WON" | "SUBMITTED") {
    tendersRepository.tenders.set(tenderId, {
      id: tenderId,
      tenderNumber: "TND-1",
      title: "Flange Slip Supply",
      status,
      business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
      client: { name: "IISCO", address: null },
    } as unknown as TenderForDocumentGeneration);
  }

  it("rejects billing a tender that is not WON", async () => {
    seedTender("SUBMITTED");

    await expect(
      service.createBill(
        { tenderId, items: [{ description: "Flange", quantity: 10, rate: 500 }] },
        actorId,
        context,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a bill with no items", async () => {
    seedTender("WON");

    await expect(service.createBill({ tenderId, items: [] }, actorId, context)).rejects.toThrow(
      BadRequestError,
    );
  });

  it("creates a bill against a WON tender and computes the total from a partial quantity", async () => {
    seedTender("WON");

    const bill = await service.createBill(
      {
        tenderId,
        grnNumber: "GRN-2201",
        grnDate: "2026-08-20",
        // BOQ line is 500 units; this bill is for 200 of them (partial delivery).
        items: [{ boqItemId: randomUUID(), description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      },
      actorId,
      context,
    );

    expect(bill.grnNumber).toBe("GRN-2201");
    expect(bill.items[0]!.quantity).toBe(200);
    expect(bill.total).toBe(90000); // 200 * 450, not the BOQ's full 500 * 450
    expect(bill.billNumber).toMatch(/^BILL-/);
  });
});
