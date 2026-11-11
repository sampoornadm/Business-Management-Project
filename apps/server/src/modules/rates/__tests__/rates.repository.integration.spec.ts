import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withBusinessScopeGuard } from "../../../infra/prisma/scoped-client.js";
import { HistoricalRatesRepository, type VendorRateRow } from "../rates.repository.js";

describe("HistoricalRatesRepository vendor/own rate recording (integration)", () => {
  let repository: HistoricalRatesRepository;
  let businessId: string;
  let userId: string;
  let vendorAId: string;
  let vendorBId: string;
  let itemId: string;
  const tenderIds: string[] = [];
  const rfqIds: string[] = [];

  async function createRfqWithQuotes(rates: { vendorId: string; rate: number }[]) {
    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId, title: "Rates Repo Test RFQ", createdById: userId },
    });
    rfqIds.push(rfq.id);
    const rfqItem = await prisma.rfqItem.create({
      data: { id: randomUUID(), rfqId: rfq.id, description: "OPC Cement", unit: "bag", quantity: 100 },
    });
    const quotes = [];
    for (const r of rates) {
      quotes.push(
        await prisma.rfqQuote.create({
          data: { id: randomUUID(), rfqItemId: rfqItem.id, vendorId: r.vendorId, rate: r.rate, make: "ACC", model: "OPC53" },
        }),
      );
    }
    return { rfqId: rfq.id, quotes };
  }

  function vendorRow(quote: { id: string; vendorId: string; rate: number | null }, isDefault: boolean): VendorRateRow {
    return {
      businessId,
      itemId,
      itemName: "OPC Cement",
      unit: "bag",
      rate: quote.rate!,
      vendorId: quote.vendorId,
      rfqQuoteId: quote.id,
      sourceTenderId: null,
      quotedAt: new Date("2026-10-01T00:00:00.000Z"),
      isDefault,
      createdById: userId,
    };
  }

  async function createTender(): Promise<string> {
    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: `Rates Client ${randomUUID()}`, type: "GOVERNMENT", createdById: userId },
    });
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `RRT-${randomUUID()}`,
        title: "Rates Test Tender",
        clientId: client.id,
        createdById: userId,
      },
    });
    tenderIds.push(tender.id);
    return tender.id;
  }

  beforeAll(async () => {
    // The app's real (business-scope-guarded) client, so a query missing businessId fails here too.
    repository = new HistoricalRatesRepository(withBusinessScopeGuard(prisma));
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Rates Repo Test ${randomUUID()}`, code: `RRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `rates-repo-test-${randomUUID()}@example.com`,
        firstName: "Rates",
        lastName: "Test",
        passwordHash: "not-a-real-hash",
        isEmailVerified: true,
      },
    });
    userId = user.id;
    vendorAId = (
      await prisma.vendor.create({
        data: { id: randomUUID(), name: "Vendor A", category: "MATERIAL_SUPPLIER", createdById: userId },
      })
    ).id;
    vendorBId = (
      await prisma.vendor.create({
        data: { id: randomUUID(), name: "Vendor B", category: "MATERIAL_SUPPLIER", createdById: userId },
      })
    ).id;
    itemId = (await prisma.item.create({ data: { id: randomUUID(), businessId, canonicalName: "opc cement", unit: "bag" } })).id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { businessId } });
    await prisma.rfq.deleteMany({ where: { id: { in: rfqIds } } });
    const tenders = await prisma.tender.findMany({ where: { id: { in: tenderIds } }, select: { clientId: true } });
    await prisma.tender.deleteMany({ where: { id: { in: tenderIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: tenders.map((t) => t.clientId) } } });
    await prisma.item.deleteMany({ where: { businessId } });
    await prisma.vendor.deleteMany({ where: { id: { in: [vendorAId, vendorBId] } } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    if (businessId) await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("recordVendorRates writes one row per quote and marks only the selected default", async () => {
    const { rfqId, quotes } = await createRfqWithQuotes([
      { vendorId: vendorAId, rate: 400 },
      { vendorId: vendorBId, rate: 380 },
    ]);

    const count = await repository.recordVendorRates(rfqId, businessId, [vendorRow(quotes[0]!, false), vendorRow(quotes[1]!, true)]);

    expect(count).toBe(2);
    const rows = await prisma.historicalRate.findMany({ where: { rfqQuoteId: { in: quotes.map((q) => q.id) } } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "VENDOR" && r.itemId === itemId)).toBe(true);
    expect(rows.find((r) => r.vendorId === vendorBId)!.isDefault).toBe(true);
    expect(rows.find((r) => r.vendorId === vendorAId)!.isDefault).toBe(false);
    expect(rows[0]!.effectiveDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("recordVendorRates keeps each RFQ's own selected quote as its default", async () => {
    const older = await createRfqWithQuotes([{ vendorId: vendorAId, rate: 410 }]);
    await repository.recordVendorRates(older.rfqId, businessId, [vendorRow(older.quotes[0]!, true)]);
    const newer = await createRfqWithQuotes([{ vendorId: vendorBId, rate: 390 }]);
    await repository.recordVendorRates(newer.rfqId, businessId, [vendorRow(newer.quotes[0]!, true)]);

    const rows = await prisma.historicalRate.findMany({
      where: { rfqQuoteId: { in: [older.quotes[0]!.id, newer.quotes[0]!.id] } },
    });
    expect(rows.every((r) => r.isDefault)).toBe(true);
  });

  it("findNearest sees chosen and hand-entered vendor rates, never a losing quote", async () => {
    const { rfqId, quotes } = await createRfqWithQuotes([
      { vendorId: vendorAId, rate: 999 },
      { vendorId: vendorBId, rate: 380 },
    ]);
    const losing = { ...vendorRow(quotes[0]!, false), itemName: "ANN Losing Quote Cement" };
    const chosen = { ...vendorRow(quotes[1]!, true), itemName: "ANN Losing Quote Cement" };
    await repository.recordVendorRates(rfqId, businessId, [losing, chosen]);
    const handEntered = await repository.create({
      businessId,
      category: "MATERIAL",
      itemName: "ANN Losing Quote Cement",
      unit: "bag",
      rate: 400,
      effectiveDate: new Date(),
      createdById: userId,
    });
    const vector = new Array(1024).fill(0);
    vector[7] = 1;
    const ids = (await prisma.historicalRate.findMany({ where: { businessId, itemName: "ANN Losing Quote Cement" } })).map((r) => r.id);
    for (const id of ids) await repository.setEmbedding(id, vector);

    const matches = await repository.findNearest(businessId, vector, 10);

    expect(matches.map((m) => m.rate).sort()).toEqual([380, 400]);
    expect(matches.some((m) => m.id === handEntered.id)).toBe(true);
  });

  it("recordVendorRates re-run drops a quote no longer in rows", async () => {
    const { rfqId, quotes } = await createRfqWithQuotes([
      { vendorId: vendorAId, rate: 400 },
      { vendorId: vendorBId, rate: 380 },
    ]);
    await repository.recordVendorRates(rfqId, businessId, [vendorRow(quotes[0]!, false), vendorRow(quotes[1]!, true)]);

    await repository.recordVendorRates(rfqId, businessId, [vendorRow(quotes[1]!, true)]);

    const rows = await prisma.historicalRate.findMany({ where: { rfqQuoteId: { in: quotes.map((q) => q.id) } } });
    expect(rows.map((r) => r.rfqQuoteId)).toEqual([quotes[1]!.id]);
  });

  it("replaceOwnRates replaces a tender's rows, leaves other tenders' rows", async () => {
    const tenderA = await createTender();
    const tenderB = await createTender();
    const own = (rate: number) => ({
      businessId,
      itemId,
      itemName: "OPC Cement",
      unit: "bag",
      rate,
      baseRate: 380,
      markupPercent: 15,
      createdById: userId,
    });
    await repository.replaceOwnRates(tenderA, businessId, [own(437)]);
    await repository.replaceOwnRates(tenderB, businessId, [own(450)]);

    await repository.replaceOwnRates(tenderA, businessId, [own(420)]);

    const rowsA = await prisma.historicalRate.findMany({ where: { sourceTenderId: tenderA, kind: "OWN" } });
    const rowsB = await prisma.historicalRate.findMany({ where: { sourceTenderId: tenderB, kind: "OWN" } });
    expect(rowsA.map((r) => r.rate)).toEqual([420]);
    expect(rowsA[0]).toMatchObject({ baseRate: 380, markupPercent: 15, itemId });
    expect(rowsB.map((r) => r.rate)).toEqual([450]);
  });

  it("findByItem returns both kinds newest first with vendor, quote and tender details", async () => {
    const rows = await repository.findByItem(itemId, businessId);

    expect(rows.length).toBeGreaterThan(0);
    const dates = rows.map((r) => r.effectiveDate.getTime());
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
    const vendorRow0 = rows.find((r) => r.kind === "VENDOR")!;
    expect(vendorRow0.vendor?.name).toMatch(/Vendor [AB]/);
    expect(vendorRow0.rfqQuote?.make).toBe("ACC");
    expect(vendorRow0.rfqQuote?.rfqItem.rfqId).toBeTruthy();
    const ownRow = rows.find((r) => r.kind === "OWN")!;
    expect(ownRow.tenderNumber).toMatch(/^RRT-/);
  });

  it("findByItem is scoped to the business", async () => {
    expect(await repository.findByItem(itemId, randomUUID())).toEqual([]);
  });
});
