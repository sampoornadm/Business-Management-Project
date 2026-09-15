import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";
import { saveGeneratedTenderDocument } from "../tenders/local-docs/generated-documents.js";

import { BILL_EXPORT_COLUMN_KEYS, buildBillExportTable } from "./bills.mapper.js";
import type { BillsService } from "./bills.service.js";
import type { CreateBillBody, ExportBillsQueryParsed, ListBillsQueryParsed } from "./bills.validation.js";

export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListBillsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.billsService.listBills(pagination, {
      ...query,
      businessId: req.user!.businessId,
    });
    sendSuccess(res, result, "Bills retrieved");
  });

  exportBills = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportBillsQueryParsed;
    const pagination = resolvePagination(query);
    const items = await this.billsService.exportBills(
      { ...query, businessId: req.user!.businessId },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? BILL_EXPORT_COLUMN_KEYS;
    const table = buildBillExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="bills-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="bills-export-${date}.csv"`);
    res.send(buffer);
  });

  getById = asyncHandler(async (req, res) => {
    const bill = await this.billsService.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, bill, "Bill retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateBillBody;
    const bill = await this.billsService.createBill(
      body,
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, bill, "Bill created", 201);
  });

  downloadPdf = asyncHandler(async (req, res) => {
    const result = await this.billsService.buildBillPdfFor(req.params.id!, req.user!.businessId);

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "BILL",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: "application/pdf",
      uploadedById: req.user!.id,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });
}
