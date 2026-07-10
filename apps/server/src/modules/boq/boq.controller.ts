import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { BoqService } from "./boq.service.js";
import type {
  BulkUpdateBoqItemsBody,
  CommitBoqBody,
  CompareBoqQueryParsed,
  CreateBoqItemBody,
  UpdateBoqItemBody,
  UpsertRateAnalysisBody,
} from "./boq.validation.js";

export class BoqController {
  constructor(private readonly boqService: BoqService) {}

  parse = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const preview = await this.boqService.parseUpload(
      req.params.id!,
      { buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype },
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, preview, "BOQ file parsed");
  });

  commit = asyncHandler(async (req, res) => {
    const body = req.body as CommitBoqBody;
    const boq = await this.boqService.commitBoq(req.params.id!, req.user!.businessId, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, boq, "BOQ committed", 201);
  });

  getCurrent = asyncHandler(async (req, res) => {
    const boq = await this.boqService.getCurrentBoq(req.params.id!, req.user!.businessId);
    sendSuccess(res, boq, "BOQ retrieved");
  });

  listVersions = asyncHandler(async (req, res) => {
    const versions = await this.boqService.listVersions(req.params.id!, req.user!.businessId);
    sendSuccess(res, versions, "BOQ versions retrieved");
  });

  finalize = asyncHandler(async (req, res) => {
    const boq = await this.boqService.finalize(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, boq, "BOQ finalized");
  });

  compare = asyncHandler(async (req, res) => {
    const query = req.query as unknown as CompareBoqQueryParsed;
    const result = await this.boqService.compare(req.params.id!, query.withTenderId, req.user!.businessId);
    sendSuccess(res, result, "BOQ comparison retrieved");
  });

  addItem = asyncHandler(async (req, res) => {
    const body = req.body as CreateBoqItemBody;
    const boq = await this.boqService.addItem(req.params.id!, body, req.user!.id, req.user!.businessId);
    sendSuccess(res, boq, "BOQ item added", 201);
  });

  updateItem = asyncHandler(async (req, res) => {
    const body = req.body as UpdateBoqItemBody;
    const boq = await this.boqService.updateItem(
      req.params.itemId!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, boq, "BOQ item updated");
  });

  deleteItem = asyncHandler(async (req, res) => {
    const boq = await this.boqService.deleteItem(req.params.itemId!, req.user!.id, req.user!.businessId);
    sendSuccess(res, boq, "BOQ item deleted");
  });

  bulkUpdate = asyncHandler(async (req, res) => {
    const body = req.body as BulkUpdateBoqItemsBody;
    const boq = await this.boqService.bulkUpdateItems(body, req.user!.id, req.user!.businessId);
    sendSuccess(res, boq, "BOQ items updated");
  });

  upsertRateAnalysis = asyncHandler(async (req, res) => {
    const body = req.body as UpsertRateAnalysisBody;
    const boq = await this.boqService.upsertRateAnalysis(
      req.params.itemId!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, boq, "Rate analysis updated");
  });
}
