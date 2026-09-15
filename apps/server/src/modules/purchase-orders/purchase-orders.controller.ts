import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { buildPurchaseOrderExportTable, PURCHASE_ORDER_EXPORT_COLUMN_KEYS } from "./purchase-orders.mapper.js";
import type { PurchaseOrdersService } from "./purchase-orders.service.js";
import type {
  CreateGoodsReceiptBody,
  CreatePurchaseOrderBody,
  CreatePurchaseOrderFromRfqBody,
  ExportPurchaseOrdersQueryParsed,
  ListPurchaseOrdersQueryParsed,
  UpdatePurchaseOrderStatusBody,
  UpsertVendorRatingBody,
} from "./purchase-orders.validation.js";

export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListPurchaseOrdersQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.purchaseOrdersService.listPurchaseOrders(pagination, {
      ...query,
      businessId: req.user!.businessId,
    });
    sendSuccess(res, result, "Purchase orders retrieved");
  });

  exportPurchaseOrders = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportPurchaseOrdersQueryParsed;
    const pagination = resolvePagination(query);
    const items = await this.purchaseOrdersService.exportPurchaseOrders(
      { ...query, businessId: req.user!.businessId },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? PURCHASE_ORDER_EXPORT_COLUMN_KEYS;
    const table = buildPurchaseOrderExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="purchase-orders-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="purchase-orders-export-${date}.csv"`);
    res.send(buffer);
  });

  getById = asyncHandler(async (req, res) => {
    const po = await this.purchaseOrdersService.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, po, "Purchase order retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreatePurchaseOrderBody;
    const po = await this.purchaseOrdersService.create(
      {
        vendorId: body.vendorId,
        tenderId: body.tenderId,
        expectedDeliveryDate: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined,
        notes: body.notes,
        items: body.items,
      },
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, po, "Purchase order created", 201);
  });

  createFromRfq = asyncHandler(async (req, res) => {
    const body = req.body as CreatePurchaseOrderFromRfqBody;
    const pos = await this.purchaseOrdersService.createFromRfq(
      body.rfqId,
      {
        expectedDeliveryDate: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : undefined,
        notes: body.notes,
      },
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, pos, "Purchase order(s) created from RFQ", 201);
  });

  updateStatus = asyncHandler(async (req, res) => {
    const body = req.body as UpdatePurchaseOrderStatusBody;
    const po = await this.purchaseOrdersService.updateStatus(
      req.params.id!,
      body.status,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, po, "Purchase order status updated");
  });

  createGoodsReceipt = asyncHandler(async (req, res) => {
    const body = req.body as CreateGoodsReceiptBody;
    const po = await this.purchaseOrdersService.createGoodsReceipt(
      req.params.id!,
      {
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : undefined,
        remarks: body.remarks,
        items: body.items,
      },
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, po, "Goods receipt recorded", 201);
  });

  upsertVendorRating = asyncHandler(async (req, res) => {
    const body = req.body as UpsertVendorRatingBody;
    const po = await this.purchaseOrdersService.upsertVendorRating(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, po, "Vendor rated");
  });
}
