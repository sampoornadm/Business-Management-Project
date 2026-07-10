import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { RatesService } from "./rates.service.js";
import type {
  CreateHistoricalRateBody,
  ListHistoricalRatesQuery,
  SuggestHistoricalRatesQueryParsed,
} from "./rates.validation.js";

export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListHistoricalRatesQuery;
    const rates = await this.ratesService.list({ ...query, businessId: req.user!.businessId });
    sendSuccess(res, rates, "Historical rates retrieved");
  });

  suggest = asyncHandler(async (req, res) => {
    const query = req.query as unknown as SuggestHistoricalRatesQueryParsed;
    const rates = await this.ratesService.suggest(
      query.category,
      query.itemName,
      query.limit ?? 5,
      req.user!.businessId,
    );
    sendSuccess(res, rates, "Rate suggestions retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateHistoricalRateBody;
    const rate = await this.ratesService.create({
      ...body,
      effectiveDate: new Date(body.effectiveDate),
      businessId: req.user!.businessId,
      createdById: req.user!.id,
    });
    sendSuccess(res, rate, "Historical rate recorded", 201);
  });
}
