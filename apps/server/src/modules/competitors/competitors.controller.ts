import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { CompetitorsService } from "./competitors.service.js";
import type { ListItemsQuery, UpdateCompetitorBody } from "./competitors.validation.js";

export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  list = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.competitors.list(req.user!.businessId), "Competitors retrieved");
  });

  listItems = asyncHandler(async (req, res) => {
    const { search } = req.query as unknown as ListItemsQuery;
    sendSuccess(res, await this.competitors.items(req.user!.businessId, search), "Competitor items retrieved");
  });

  getItemComparison = asyncHandler(async (req, res) => {
    const comparison = await this.competitors.itemComparison(req.user!.businessId, req.params.itemCode!);
    sendSuccess(res, comparison, "Item comparison retrieved");
  });

  getRatesToBeat = asyncHandler(async (req, res) => {
    const rates = await this.competitors.ratesToBeat(req.user!.businessId, req.params.tenderId!);
    sendSuccess(res, rates, "Rates to beat retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.competitors.detail(req.user!.businessId, req.params.id!), "Competitor retrieved");
  });

  update = asyncHandler(async (req, res) => {
    const { isSelf } = req.body as UpdateCompetitorBody;
    await this.competitors.setSelf(req.user!.businessId, req.params.id!, isSelf);
    sendSuccess(res, await this.competitors.detail(req.user!.businessId, req.params.id!), "Competitor updated");
  });
}
