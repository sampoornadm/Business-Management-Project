import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { RfqService } from "./rfq.service.js";
import type {
  AddRfqVendorBody,
  CreateRfqBody,
  ImportQuotesBody,
  InviteVendorBody,
  InviteVendorPreviewBody,
  ListItemPricesQueryParsed,
  ListRfqsQueryParsed,
  SelectQuoteBody,
  SuggestVendorsBody,
  UpdateRfqBody,
  UpsertRfqQuoteBody,
} from "./rfq.validation.js";

export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListRfqsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.rfqService.listRfqs(pagination, {
      businessId: req.user!.businessId,
      status: query.status,
      tenderId: query.tenderId,
    });
    sendSuccess(res, result, "RFQs retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, rfq, "RFQ retrieved");
  });

  itemPrices = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListItemPricesQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.rfqService.listItemPrices(pagination, {
      businessId: req.user!.businessId,
      search: query.search,
      vendorId: query.vendorId,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    sendSuccess(res, result, "Item price history retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateRfqBody;
    const rfq = await this.rfqService.create(
      {
        title: body.title,
        tenderId: body.tenderId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        instructions: body.instructions,
        items: body.items,
        vendorIds: body.vendorIds,
      },
      req.user!.id,
      { ipAddress: req.ip, userAgent: req.headers["user-agent"], businessId: req.user!.businessId },
    );
    sendSuccess(res, rfq, "RFQ created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateRfqBody;
    const rfq = await this.rfqService.update(
      req.params.id!,
      {
        title: body.title,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        instructions: body.instructions,
      },
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "RFQ updated");
  });

  addVendor = asyncHandler(async (req, res) => {
    const body = req.body as AddRfqVendorBody;
    const rfq = await this.rfqService.addVendorInvite(
      req.params.id!,
      body.vendorId,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "Vendor invited", 201);
  });

  removeVendor = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.removeVendorInvite(
      req.params.id!,
      req.params.vendorId!,
      req.user!.id,
      req.user!.businessId,
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
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "Quote recorded");
  });

  downloadQuoteSheet = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildQuoteSheetFor(
      req.params.id!,
      req.user!.businessId,
    );
    // A file download, not a JSON envelope — send the raw buffer.
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  downloadRfrPdf = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildRfrPdfFor(req.params.id!, req.user!.businessId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  downloadRfrWord = asyncHandler(async (req, res) => {
    const { filename, buffer } = await this.rfqService.buildRfrDocxFor(req.params.id!, req.user!.businessId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  });

  importQuotes = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const body = req.body as ImportQuotesBody;
    const result = await this.rfqService.importQuotes(
      req.params.id!,
      body.vendorId,
      req.file.buffer,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, result, `Imported ${result.imported} quote(s)`);
  });

  comparison = asyncHandler(async (req, res) => {
    const comparison = await this.rfqService.getComparison(req.params.id!, req.user!.businessId);
    sendSuccess(res, comparison, "Comparison retrieved");
  });

  selectQuote = asyncHandler(async (req, res) => {
    const body = req.body as SelectQuoteBody;
    const rfq = await this.rfqService.selectQuote(
      req.params.id!,
      req.params.itemId!,
      body.quoteId,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, rfq, "Quote selected");
  });

  close = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.close(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, rfq, "RFQ closed");
  });

  reopen = asyncHandler(async (req, res) => {
    const rfq = await this.rfqService.reopen(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, rfq, "RFQ reopened");
  });

  suggestVendors = asyncHandler(async (req, res) => {
    const body = req.body as SuggestVendorsBody;
    const suggestions = await this.rfqService.suggestVendors(body.boqItemIds, req.user!.businessId);
    sendSuccess(res, suggestions, "Vendor suggestions retrieved");
  });

  previewInviteVendor = asyncHandler(async (req, res) => {
    const body = req.body as InviteVendorPreviewBody;
    const preview = await this.rfqService.previewInviteVendor(req.params.id!, body, req.user!.businessId);
    sendSuccess(res, preview, "Invite preview generated");
  });

  inviteVendor = asyncHandler(async (req, res) => {
    const body = req.body as InviteVendorBody;
    const rfq = await this.rfqService.inviteVendor(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      businessId: req.user!.businessId,
    });
    sendSuccess(res, rfq, "Vendor invited", 201);
  });
}
