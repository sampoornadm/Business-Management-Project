import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { BadRequestError } from "../../../core/errors/HttpErrors.js";
import type {
  IReportsRepository,
  PaymentBasicRow,
  ProjectBasicRow,
  PurchaseOrderForOnTimeRow,
  PurchaseOrderSpendRow,
} from "../reports.repository.js";
import { ReportsService } from "../reports.service.js";

class FakeReportsRepository implements IReportsRepository {
  tenderStatusCounts: { status: never; count: number }[] = [];
  tenderDates: { createdAt: Date; submissionDate: Date }[] = [];
  poSpendItems: PurchaseOrderSpendRow[] = [];
  activeProjects: ProjectBasicRow[] = [];
  poTotalsByTender: { tenderId: string; amount: number }[] = [];
  laborTotalsByProject: { projectId: string; amount: number }[] = [];
  payments: PaymentBasicRow[] = [];
  vendors: { id: string; name: string }[] = [];
  vendorRatings: { vendorId: string; rating: number }[] = [];
  poCountsByVendor: { vendorId: string; count: number }[] = [];
  posForOnTime: PurchaseOrderForOnTimeRow[] = [];
  latestReceiptsByPo: { purchaseOrderId: string; receivedDate: Date }[] = [];
  invoiceTotals: { totalAmount: number; invoiceDate: Date }[] = [];
  invoicePaymentsSum = 0;
  goodsReceiptLeadTimes: { purchaseOrderCreatedAt: Date; receivedDate: Date }[] = [];
  boqLeadTimes: { tenderCreatedAt: Date; boqCreatedAt: Date }[] = [];

  async findTenderStatusCounts(_businessId: string) {
    return this.tenderStatusCounts;
  }
  async findTenderDates(_businessId: string) {
    return this.tenderDates;
  }
  async findPurchaseOrderItemsForSpend(_businessId: string) {
    return this.poSpendItems;
  }
  async findActiveProjectsBasic(_businessId: string) {
    return this.activeProjects;
  }
  async findPurchaseOrderTotalsByTenderIds(_businessId: string) {
    return this.poTotalsByTender;
  }
  async findLaborTotalsByProjectIds(_businessId: string) {
    return this.laborTotalsByProject;
  }
  async findPaymentsForSummary(_businessId: string) {
    return this.payments;
  }
  async findVendorsBasic() {
    return this.vendors;
  }
  async findVendorRatings(_businessId: string) {
    return this.vendorRatings;
  }
  async findPurchaseOrdersForOnTimeCalc(_businessId: string) {
    return this.posForOnTime;
  }
  async findLatestGoodsReceiptDatesByPoIds(_businessId: string) {
    return this.latestReceiptsByPo;
  }
  async countPurchaseOrdersByVendor(_businessId: string) {
    return this.poCountsByVendor;
  }
  async findAllInvoiceTotals(_businessId: string) {
    return this.invoiceTotals;
  }
  async sumPaymentsByEntityType(_businessId: string) {
    return this.invoicePaymentsSum;
  }
  async findGoodsReceiptLeadTimes(_businessId: string) {
    return this.goodsReceiptLeadTimes;
  }
  async findBoqCreationLeadTimes(_businessId: string) {
    return this.boqLeadTimes;
  }
  async searchTenders(_businessId: string) {
    return [];
  }
  async searchOrganizations() {
    return [];
  }
  async searchVendors() {
    return [];
  }
  async searchProjects(_businessId: string) {
    return [];
  }
}

const DAY = 24 * 60 * 60 * 1000;

describe("ReportsService", () => {
  const businessId = randomUUID();

  it("returns a null win rate when no tenders have been decided", async () => {
    const repo = new FakeReportsRepository();
    repo.tenderStatusCounts = [{ status: "DRAFT" as never, count: 3 }];
    const service = new ReportsService(repo);
    const report = await service.getTenderPipeline(businessId);
    expect(report.winRate).toBeNull();
    expect(report.totalTenders).toBe(3);
  });

  it("computes win rate and avg submission days", async () => {
    const repo = new FakeReportsRepository();
    repo.tenderStatusCounts = [
      { status: "WON" as never, count: 3 },
      { status: "LOST" as never, count: 1 },
    ];
    const base = new Date("2026-01-01");
    repo.tenderDates = [
      { createdAt: base, submissionDate: new Date(base.getTime() + 10 * DAY) },
      { createdAt: base, submissionDate: new Date(base.getTime() + 20 * DAY) },
    ];
    const service = new ReportsService(repo);
    const report = await service.getTenderPipeline(businessId);
    expect(report.winRate).toBe(75);
    expect(report.avgSubmissionDays).toBe(15);
  });

  it("groups procurement spend by vendor and month", async () => {
    const repo = new FakeReportsRepository();
    const vendorA = randomUUID();
    const vendorB = randomUUID();
    repo.poSpendItems = [
      { amount: 1000, vendorId: vendorA, vendorName: "Ace Steel", poCreatedAt: new Date("2026-01-05") },
      { amount: 2000, vendorId: vendorA, vendorName: "Ace Steel", poCreatedAt: new Date("2026-02-05") },
      { amount: 500, vendorId: vendorB, vendorName: "BuildCo", poCreatedAt: new Date("2026-01-10") },
    ];
    const service = new ReportsService(repo);
    const report = await service.getProcurementSpend(businessId);
    expect(report.grandTotal).toBe(3500);
    expect(report.byVendor[0]).toEqual({ vendorId: vendorA, vendorName: "Ace Steel", total: 3000 });
    expect(report.byMonth).toEqual([
      { month: "2026-01", total: 1500 },
      { month: "2026-02", total: 2000 },
    ]);
  });

  it("computes project costing as budget minus PO and labor spend", async () => {
    const repo = new FakeReportsRepository();
    const tenderId = randomUUID();
    const projectId = randomUUID();
    repo.activeProjects = [
      { id: projectId, name: "Highway Widening", status: "ACTIVE", budget: 500000, tenderId },
    ];
    repo.poTotalsByTender = [{ tenderId, amount: 200000 }];
    repo.laborTotalsByProject = [{ projectId, amount: 50000 }];
    const service = new ReportsService(repo);
    const report = await service.getProjectCosting(businessId);
    expect(report.projects[0]!.actualCost).toBe(250000);
    expect(report.projects[0]!.variance).toBe(250000);
  });

  it("buckets payments into monthly received/paid/net totals", async () => {
    const repo = new FakeReportsRepository();
    repo.payments = [
      { direction: "RECEIVED", amount: 1000, paymentDate: new Date("2026-01-15") },
      { direction: "PAID", amount: 300, paymentDate: new Date("2026-01-20") },
      { direction: "RECEIVED", amount: 500, paymentDate: new Date("2026-02-01") },
    ];
    const service = new ReportsService(repo);
    const report = await service.getFinancialSummary(businessId);
    expect(report.months).toEqual([
      { month: "2026-01", received: 1000, paid: 300, net: 700 },
      { month: "2026-02", received: 500, paid: 0, net: 500 },
    ]);
  });

  it("computes vendor on-time delivery rate and average rating, excluding inactive vendors", async () => {
    const repo = new FakeReportsRepository();
    const vendorA = randomUUID();
    const vendorB = randomUUID();
    const poOnTime = randomUUID();
    const poLate = randomUUID();
    repo.vendors = [
      { id: vendorA, name: "Ace Steel" },
      { id: vendorB, name: "Unused Vendor" },
    ];
    repo.vendorRatings = [
      { vendorId: vendorA, rating: 4 },
      { vendorId: vendorA, rating: 5 },
    ];
    repo.poCountsByVendor = [{ vendorId: vendorA, count: 2 }];
    repo.posForOnTime = [
      { id: poOnTime, vendorId: vendorA, expectedDeliveryDate: new Date("2026-01-10") },
      { id: poLate, vendorId: vendorA, expectedDeliveryDate: new Date("2026-01-10") },
    ];
    repo.latestReceiptsByPo = [
      { purchaseOrderId: poOnTime, receivedDate: new Date("2026-01-09") },
      { purchaseOrderId: poLate, receivedDate: new Date("2026-01-15") },
    ];
    const service = new ReportsService(repo);
    const report = await service.getVendorPerformance(businessId);
    expect(report.vendors).toHaveLength(1);
    expect(report.vendors[0]!.vendorName).toBe("Ace Steel");
    expect(report.vendors[0]!.averageRating).toBe(4.5);
    expect(report.vendors[0]!.onTimeDeliveryRate).toBe(50);
  });

  it("computes KPIs including a null DSO when there are no invoices", async () => {
    const repo = new FakeReportsRepository();
    repo.tenderStatusCounts = [
      { status: "WON" as never, count: 1 },
      { status: "LOST" as never, count: 1 },
    ];
    const service = new ReportsService(repo);
    const kpis = await service.getKpis(businessId);
    expect(kpis.winRate).toBe(50);
    expect(kpis.receivablesDsoDays).toBeNull();
  });

  it("computes a positive DSO when invoices are outstanding", async () => {
    const repo = new FakeReportsRepository();
    repo.invoiceTotals = [
      { totalAmount: 100000, invoiceDate: new Date("2026-01-01") },
      { totalAmount: 100000, invoiceDate: new Date("2026-01-31") },
    ];
    repo.invoicePaymentsSum = 50000;
    const service = new ReportsService(repo);
    const kpis = await service.getKpis(businessId);
    expect(kpis.receivablesDsoDays).not.toBeNull();
    expect(kpis.receivablesDsoDays).toBeGreaterThan(0);
  });

  it("rejects a search query shorter than 2 characters", async () => {
    const repo = new FakeReportsRepository();
    const service = new ReportsService(repo);
    await expect(service.search(businessId, "a")).rejects.toThrow(BadRequestError);
  });
});
