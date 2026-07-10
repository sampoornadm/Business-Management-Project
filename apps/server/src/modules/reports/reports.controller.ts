import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import { exportTableToPdf, exportTableToXlsx } from "./reports.export.js";
import type { ReportsService } from "./reports.service.js";
import type {
  ExportReportParams,
  ExportReportQueryParsed,
  ReportDateRangeQueryParsed,
  SearchQueryParsed,
} from "./reports.validation.js";

function parseDateRange(query: ReportDateRangeQueryParsed): { from?: Date; to?: Date } {
  return {
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  getTenderPipeline = asyncHandler(async (req, res) => {
    const report = await this.reportsService.getTenderPipeline(req.user!.businessId);
    sendSuccess(res, report, "Tender pipeline report retrieved");
  });

  getProcurementSpend = asyncHandler(async (req, res) => {
    const { from, to } = parseDateRange(req.query as unknown as ReportDateRangeQueryParsed);
    const report = await this.reportsService.getProcurementSpend(req.user!.businessId, from, to);
    sendSuccess(res, report, "Procurement spend report retrieved");
  });

  getProjectCosting = asyncHandler(async (req, res) => {
    const report = await this.reportsService.getProjectCosting(req.user!.businessId);
    sendSuccess(res, report, "Project costing report retrieved");
  });

  getFinancialSummary = asyncHandler(async (req, res) => {
    const { from, to } = parseDateRange(req.query as unknown as ReportDateRangeQueryParsed);
    const report = await this.reportsService.getFinancialSummary(req.user!.businessId, from, to);
    sendSuccess(res, report, "Financial summary report retrieved");
  });

  getVendorPerformance = asyncHandler(async (req, res) => {
    const report = await this.reportsService.getVendorPerformance(req.user!.businessId);
    sendSuccess(res, report, "Vendor performance report retrieved");
  });

  getKpis = asyncHandler(async (req, res) => {
    const kpis = await this.reportsService.getKpis(req.user!.businessId);
    sendSuccess(res, kpis, "KPIs retrieved");
  });

  search = asyncHandler(async (req, res) => {
    const { q } = req.query as unknown as SearchQueryParsed;
    const results = await this.reportsService.search(req.user!.businessId, q);
    sendSuccess(res, results, "Search results retrieved");
  });

  exportReport = asyncHandler(async (req, res) => {
    const { reportKey } = req.params as unknown as ExportReportParams;
    const query = req.query as unknown as ExportReportQueryParsed;
    const { from, to } = parseDateRange(query);
    const table = await this.reportsService.getExportableTable(req.user!.businessId, reportKey, from, to);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${reportKey}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = await exportTableToPdf(table);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${reportKey}.pdf"`);
    res.send(buffer);
  });
}
