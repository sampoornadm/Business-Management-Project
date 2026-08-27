import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { BillsService } from "./bills.service.js";
import type { CreateBillBody, ListBillsQueryParsed } from "./bills.validation.js";

export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListBillsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.billsService.listBills(pagination, req.user!.businessId);
    sendSuccess(res, result, "Bills retrieved");
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
}
