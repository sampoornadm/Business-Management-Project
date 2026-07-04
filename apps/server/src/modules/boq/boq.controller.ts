import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { BoqService } from "./boq.service.js";
import type {
  BulkUpdateBoqItemsBody,
  CommitBoqBody,
  CompareBoqQueryParsed,
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
    );
    sendSuccess(res, preview, "BOQ file parsed");
  });

  commit = asyncHandler(async (req, res) => {
    const body = req.body as CommitBoqBody;
    const boq = await this.boqService.commitBoq(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, boq, "BOQ committed", 201);
  });

  getCurrent = asyncHandler(async (req, res) => {
    const boq = await this.boqService.getCurrentBoq(req.params.id!);
    sendSuccess(res, boq, "BOQ retrieved");
  });

  listVersions = asyncHandler(async (req, res) => {
    const versions = await this.boqService.listVersions(req.params.id!);
    sendSuccess(res, versions, "BOQ versions retrieved");
  });

  finalize = asyncHandler(async (req, res) => {
    const boq = await this.boqService.finalize(req.params.id!, req.user!.id);
    sendSuccess(res, boq, "BOQ finalized");
  });

  compare = asyncHandler(async (req, res) => {
    const query = req.query as unknown as CompareBoqQueryParsed;
    const result = await this.boqService.compare(req.params.id!, query.withTenderId);
    sendSuccess(res, result, "BOQ comparison retrieved");
  });

  updateItem = asyncHandler(async (req, res) => {
    const body = req.body as UpdateBoqItemBody;
    const boq = await this.boqService.updateItem(req.params.itemId!, body, req.user!.id);
    sendSuccess(res, boq, "BOQ item updated");
  });

  bulkUpdate = asyncHandler(async (req, res) => {
    const body = req.body as BulkUpdateBoqItemsBody;
    const boq = await this.boqService.bulkUpdateItems(body, req.user!.id);
    sendSuccess(res, boq, "BOQ items updated");
  });

  upsertRateAnalysis = asyncHandler(async (req, res) => {
    const body = req.body as UpsertRateAnalysisBody;
    const boq = await this.boqService.upsertRateAnalysis(req.params.itemId!, body, req.user!.id);
    sendSuccess(res, boq, "Rate analysis updated");
  });
}
