import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { RfqService } from "./rfq.service.js";
import type {
  AddRfqVendorBody,
  AwardRfqBody,
  CreateRfqBody,
  ListRfqsQueryParsed,
  UpdateRfqBody,
  UpsertRfqQuoteBody,
} from "./rfq.validation.js";

export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListRfqsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.rfqService.listRfqs(pagination, {
      status: query.status,
      tenderId: query.tenderId,
    });
    sendSuccess(res, result, "RFQs retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.getById(req.params.id!);
    sendSuccess(res, rfq, "RFQ retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateRfqBody;
    const rfq = await this.rfqService.create(
      {
        title: body.title,
        tenderId: body.tenderId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        items: body.items,
        vendorIds: body.vendorIds,
      },
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    );
    sendSuccess(res, rfq, "RFQ created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateRfqBody;
    const rfq = await this.rfqService.update(
      req.params.id!,
      { title: body.title, dueDate: body.dueDate ? new Date(body.dueDate) : undefined },
      req.user!.id,
    );
    sendSuccess(res, rfq, "RFQ updated");
  });

  addVendor = asyncHandler(async (req, res) => {
    const body = req.body as AddRfqVendorBody;
    const rfq = await this.rfqService.addVendorInvite(req.params.id!, body.vendorId, req.user!.id);
    sendSuccess(res, rfq, "Vendor invited", 201);
  });

  removeVendor = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.removeVendorInvite(
      req.params.id!,
      req.params.vendorId!,
      req.user!.id,
    );
    sendSuccess(res, rfq, "Vendor invite removed");
  });

  upsertQuote = asyncHandler(async (req, res) => {
    const body = req.body as UpsertRfqQuoteBody;
    const rfq = await this.rfqService.upsertQuote(
      req.params.itemId!,
      req.params.vendorId!,
      body,
      req.user!.id,
    );
    sendSuccess(res, rfq, "Quote recorded");
  });

  comparison = asyncHandler(async (req, res) => {
    const comparison = await this.rfqService.getComparison(req.params.id!);
    sendSuccess(res, comparison, "Comparison retrieved");
  });

  award = asyncHandler(async (req, res) => {
    const body = req.body as AwardRfqBody;
    const rfq = await this.rfqService.award(req.params.id!, body.vendorId, req.user!.id);
    sendSuccess(res, rfq, "RFQ awarded");
  });

  close = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.close(req.params.id!, req.user!.id);
    sendSuccess(res, rfq, "RFQ closed");
  });
}
