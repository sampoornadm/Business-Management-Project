import type {
  FinancialSummaryReportDto,
  KpiDto,
  ProcurementSpendReportDto,
  ProjectCostingReportDto,
  ReportKey,
  SearchResultItemDto,
  SearchResultsDto,
  TenderPipelineReportDto,
  VendorPerformanceReportDto,
} from "@bmp/types";

import { REPORT_CACHE_TTL_SECONDS } from "../../config/constants.js";
import { isTest } from "../../config/env.js";
import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { getCachedJson, setCachedJson } from "../../infra/redis/cache.js";
import { round2 } from "../../shared/utils/math.js";

import type { IReportsRepository } from "./reports.repository.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Caching is skipped in test env: fake-repository unit tests reuse the same cache keys across
// cases with different data, and the dedicated infra/redis/cache tests already cover the
// get/set/TTL mechanics against a real Redis instance.
async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  if (isTest) return compute();
  const hit = await getCachedJson<T>(key);
  if (hit !== null) return hit;
  const value = await compute();
  await setCachedJson(key, value, REPORT_CACHE_TTL_SECONDS);
  return value;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((sum, v) => sum + v, 0) / values.length);
}

export interface ExportableTable {
  title: string;
  columns: { key: string; header: string }[];
  rows: Record<string, string | number>[];
}

export class ReportsService {
  constructor(private readonly reportsRepository: IReportsRepository) {}

  async getTenderPipeline(): Promise<TenderPipelineReportDto> {
    return cached("reports:tender-pipeline", () => this.computeTenderPipeline());
  }

  private async computeTenderPipeline(): Promise<TenderPipelineReportDto> {
    const [statusCounts, dates] = await Promise.all([
      this.reportsRepository.findTenderStatusCounts(),
      this.reportsRepository.findTenderDates(),
    ]);

    const totalTenders = statusCounts.reduce((sum, s) => sum + s.count, 0);
    const wonCount = statusCounts.find((s) => s.status === "WON")?.count ?? 0;
    const lostCount = statusCounts.find((s) => s.status === "LOST")?.count ?? 0;
    const decided = wonCount + lostCount;

    return {
      byStatus: statusCounts.map((s) => ({ status: s.status, count: s.count })),
      totalTenders,
      wonCount,
      lostCount,
      winRate: decided > 0 ? round2((wonCount / decided) * 100) : null,
      avgSubmissionDays: average(
        dates.map((d) => (d.submissionDate.getTime() - d.createdAt.getTime()) / MS_PER_DAY),
      ),
    };
  }

  async getProcurementSpend(from?: Date, to?: Date): Promise<ProcurementSpendReportDto> {
    const items = await this.reportsRepository.findPurchaseOrderItemsForSpend(from, to);

    const byVendorMap = new Map<string, { vendorName: string; total: number }>();
    const byMonthMap = new Map<string, number>();
    for (const item of items) {
      const vendorEntry = byVendorMap.get(item.vendorId) ?? { vendorName: item.vendorName, total: 0 };
      vendorEntry.total = round2(vendorEntry.total + item.amount);
      byVendorMap.set(item.vendorId, vendorEntry);

      const key = monthKey(item.poCreatedAt);
      byMonthMap.set(key, round2((byMonthMap.get(key) ?? 0) + item.amount));
    }

    return {
      byVendor: [...byVendorMap.entries()]
        .map(([vendorId, v]) => ({ vendorId, vendorName: v.vendorName, total: v.total }))
        .sort((a, b) => b.total - a.total),
      byMonth: [...byMonthMap.entries()]
        .map(([month, total]) => ({ month, total }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      grandTotal: round2(items.reduce((sum, item) => sum + item.amount, 0)),
    };
  }

  async getProjectCosting(): Promise<ProjectCostingReportDto> {
    const projects = await this.reportsRepository.findActiveProjectsBasic();
    const tenderIds = projects.map((p) => p.tenderId);
    const projectIds = projects.map((p) => p.id);

    const [poTotals, laborTotals] = await Promise.all([
      this.reportsRepository.findPurchaseOrderTotalsByTenderIds(tenderIds),
      this.reportsRepository.findLaborTotalsByProjectIds(projectIds),
    ]);

    const poByTender = new Map<string, number>();
    for (const row of poTotals) poByTender.set(row.tenderId, round2((poByTender.get(row.tenderId) ?? 0) + row.amount));
    const laborByProject = new Map<string, number>();
    for (const row of laborTotals) {
      laborByProject.set(row.projectId, round2((laborByProject.get(row.projectId) ?? 0) + row.amount));
    }

    const rows = projects.map((p) => {
      const actualCost = round2((poByTender.get(p.tenderId) ?? 0) + (laborByProject.get(p.id) ?? 0));
      return {
        projectId: p.id,
        name: p.name,
        status: p.status,
        budget: p.budget,
        actualCost,
        variance: round2(p.budget - actualCost),
      };
    });

    return {
      projects: rows,
      totalBudget: round2(rows.reduce((sum, r) => sum + r.budget, 0)),
      totalActualCost: round2(rows.reduce((sum, r) => sum + r.actualCost, 0)),
    };
  }

  async getFinancialSummary(from?: Date, to?: Date): Promise<FinancialSummaryReportDto> {
    const payments = await this.reportsRepository.findPaymentsForSummary(from, to);

    const byMonth = new Map<string, { received: number; paid: number }>();
    for (const payment of payments) {
      const key = monthKey(payment.paymentDate);
      const entry = byMonth.get(key) ?? { received: 0, paid: 0 };
      if (payment.direction === "RECEIVED") entry.received = round2(entry.received + payment.amount);
      else entry.paid = round2(entry.paid + payment.amount);
      byMonth.set(key, entry);
    }

    return {
      months: [...byMonth.entries()]
        .map(([month, v]) => ({ month, received: v.received, paid: v.paid, net: round2(v.received - v.paid) }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  async getVendorPerformance(): Promise<VendorPerformanceReportDto> {
    return cached("reports:vendor-performance", () => this.computeVendorPerformance());
  }

  private async computeVendorPerformance(): Promise<VendorPerformanceReportDto> {
    const [vendors, ratings, poCounts, pos] = await Promise.all([
      this.reportsRepository.findVendorsBasic(),
      this.reportsRepository.findVendorRatings(),
      this.reportsRepository.countPurchaseOrdersByVendor(),
      this.reportsRepository.findPurchaseOrdersForOnTimeCalc(),
    ]);

    const latestReceipts = await this.reportsRepository.findLatestGoodsReceiptDatesByPoIds(
      pos.map((p) => p.id),
    );
    const latestReceiptByPo = new Map<string, Date>();
    for (const receipt of latestReceipts) {
      if (!latestReceiptByPo.has(receipt.purchaseOrderId)) {
        latestReceiptByPo.set(receipt.purchaseOrderId, receipt.receivedDate);
      }
    }

    const onTimeByVendor = new Map<string, { onTime: number; total: number }>();
    for (const po of pos) {
      const receivedDate = latestReceiptByPo.get(po.id);
      if (!receivedDate || !po.expectedDeliveryDate) continue;
      const entry = onTimeByVendor.get(po.vendorId) ?? { onTime: 0, total: 0 };
      entry.total += 1;
      if (receivedDate.getTime() <= po.expectedDeliveryDate.getTime()) entry.onTime += 1;
      onTimeByVendor.set(po.vendorId, entry);
    }

    const ratingsByVendor = new Map<string, number[]>();
    for (const rating of ratings) {
      const list = ratingsByVendor.get(rating.vendorId) ?? [];
      list.push(rating.rating);
      ratingsByVendor.set(rating.vendorId, list);
    }

    const poCountByVendor = new Map(poCounts.map((c) => [c.vendorId, c.count]));

    const vendorRows = vendors
      .map((vendor) => {
        const ratingList = ratingsByVendor.get(vendor.id) ?? [];
        const onTime = onTimeByVendor.get(vendor.id);
        return {
          vendorId: vendor.id,
          vendorName: vendor.name,
          averageRating: average(ratingList),
          totalRatings: ratingList.length,
          onTimeDeliveryRate: onTime && onTime.total > 0 ? round2((onTime.onTime / onTime.total) * 100) : null,
          totalPurchaseOrders: poCountByVendor.get(vendor.id) ?? 0,
        };
      })
      .filter((v) => v.totalPurchaseOrders > 0 || v.totalRatings > 0)
      .sort((a, b) => b.totalPurchaseOrders - a.totalPurchaseOrders);

    return { vendors: vendorRows };
  }

  async getKpis(): Promise<KpiDto> {
    return cached("reports:kpis", () => this.computeKpis());
  }

  private async computeKpis(): Promise<KpiDto> {
    const [statusCounts, goodsReceiptLeadTimes, boqLeadTimes, invoices, invoicePaid] = await Promise.all([
      this.reportsRepository.findTenderStatusCounts(),
      this.reportsRepository.findGoodsReceiptLeadTimes(),
      this.reportsRepository.findBoqCreationLeadTimes(),
      this.reportsRepository.findAllInvoiceTotals(),
      this.reportsRepository.sumPaymentsByEntityType("Invoice"),
    ]);

    const wonCount = statusCounts.find((s) => s.status === "WON")?.count ?? 0;
    const lostCount = statusCounts.find((s) => s.status === "LOST")?.count ?? 0;
    const decided = wonCount + lostCount;

    const totalInvoiced = round2(invoices.reduce((sum, i) => sum + i.totalAmount, 0));
    const totalReceivables = round2(totalInvoiced - invoicePaid);

    // DSO approximation: outstanding receivables relative to total invoiced,
    // scaled by the span of days the invoiced amounts were spread across —
    // a single-period stand-in for the textbook rolling-window DSO formula,
    // adequate for an ERP-scale dashboard KPI, not a GAAP-audited metric.
    let receivablesDsoDays: number | null = null;
    if (totalInvoiced > 0 && invoices.length > 0) {
      const invoiceDateMs = invoices.map((i) => i.invoiceDate.getTime());
      const daysSpan = Math.max(1, Math.round((Math.max(...invoiceDateMs) - Math.min(...invoiceDateMs)) / MS_PER_DAY)) || 30;
      receivablesDsoDays = round2((totalReceivables / totalInvoiced) * daysSpan);
    }

    return {
      winRate: decided > 0 ? round2((wonCount / decided) * 100) : null,
      avgBoqTurnaroundDays: average(
        boqLeadTimes.map((t) => (t.boqCreatedAt.getTime() - t.tenderCreatedAt.getTime()) / MS_PER_DAY),
      ),
      avgGoodsReceiptLeadDays: average(
        goodsReceiptLeadTimes.map(
          (t) => (t.receivedDate.getTime() - t.purchaseOrderCreatedAt.getTime()) / MS_PER_DAY,
        ),
      ),
      receivablesDsoDays,
    };
  }

  async search(query: string): Promise<SearchResultsDto> {
    const trimmed = query.trim();
    if (trimmed.length < 2) throw new BadRequestError("Search query must be at least 2 characters");

    const [tenders, organizations, vendors, projects] = await Promise.all([
      this.reportsRepository.searchTenders(trimmed),
      this.reportsRepository.searchOrganizations(trimmed),
      this.reportsRepository.searchVendors(trimmed),
      this.reportsRepository.searchProjects(trimmed),
    ]);

    const results: SearchResultItemDto[] = [
      ...tenders.map((t) => ({
        type: "Tender" as const,
        id: t.id,
        title: t.title,
        subtitle: t.tenderNumber,
        href: `/tenders/${t.id}`,
      })),
      ...organizations.map((o) => ({
        type: "Organization" as const,
        id: o.id,
        title: o.name,
        subtitle: null,
        href: `/organizations/${o.id}`,
      })),
      ...vendors.map((v) => ({
        type: "Vendor" as const,
        id: v.id,
        title: v.name,
        subtitle: null,
        href: `/vendors/${v.id}`,
      })),
      ...projects.map((p) => ({
        type: "Project" as const,
        id: p.id,
        title: p.name,
        subtitle: null,
        href: `/projects/${p.id}`,
      })),
    ];

    return { query: trimmed, results };
  }

  async getExportableTable(reportKey: ReportKey, from?: Date, to?: Date): Promise<ExportableTable> {
    switch (reportKey) {
      case "tender-pipeline": {
        const report = await this.getTenderPipeline();
        return {
          title: "Tender Pipeline",
          columns: [
            { key: "status", header: "Status" },
            { key: "count", header: "Count" },
          ],
          rows: report.byStatus.map((s) => ({ status: s.status, count: s.count })),
        };
      }
      case "procurement-spend": {
        const report = await this.getProcurementSpend(from, to);
        return {
          title: "Procurement Spend by Vendor",
          columns: [
            { key: "vendorName", header: "Vendor" },
            { key: "total", header: "Total Spend" },
          ],
          rows: report.byVendor.map((v) => ({ vendorName: v.vendorName, total: v.total })),
        };
      }
      case "project-costing": {
        const report = await this.getProjectCosting();
        return {
          title: "Project Costing",
          columns: [
            { key: "name", header: "Project" },
            { key: "status", header: "Status" },
            { key: "budget", header: "Budget" },
            { key: "actualCost", header: "Actual Cost" },
            { key: "variance", header: "Variance" },
          ],
          rows: report.projects.map((p) => ({
            name: p.name,
            status: p.status,
            budget: p.budget,
            actualCost: p.actualCost,
            variance: p.variance,
          })),
        };
      }
      case "financial-summary": {
        const report = await this.getFinancialSummary(from, to);
        return {
          title: "Financial Summary",
          columns: [
            { key: "month", header: "Month" },
            { key: "received", header: "Received" },
            { key: "paid", header: "Paid" },
            { key: "net", header: "Net" },
          ],
          rows: report.months.map((m) => ({ month: m.month, received: m.received, paid: m.paid, net: m.net })),
        };
      }
      case "vendor-performance": {
        const report = await this.getVendorPerformance();
        return {
          title: "Vendor Performance",
          columns: [
            { key: "vendorName", header: "Vendor" },
            { key: "averageRating", header: "Avg Rating" },
            { key: "onTimeDeliveryRate", header: "On-Time %" },
            { key: "totalPurchaseOrders", header: "Total POs" },
          ],
          rows: report.vendors.map((v) => ({
            vendorName: v.vendorName,
            averageRating: v.averageRating ?? "-",
            onTimeDeliveryRate: v.onTimeDeliveryRate ?? "-",
            totalPurchaseOrders: v.totalPurchaseOrders,
          })),
        };
      }
      default:
        throw new BadRequestError(`Unknown report: ${reportKey as string}`);
    }
  }
}
