import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { ItemsService } from "./items.service.js";
import type {
  ClassifyBatchQuery,
  ListItemsQueryParsed,
  UpdateItemCategoryBody,
} from "./items.validation.js";

export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListItemsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.itemsService.listItems(pagination, {
      businessId: req.user!.businessId,
      search: query.search,
      status: query.status,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    sendSuccess(res, result, "Items retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const item = await this.itemsService.getItemDetail(req.params.id!, req.user!.businessId);
    sendSuccess(res, item, "Item retrieved");
  });

  setCategory = asyncHandler(async (req, res) => {
    const body = req.body as UpdateItemCategoryBody;
    const item = await this.itemsService.setCategory(req.params.id!, req.user!.businessId, body);
    sendSuccess(res, item, "Item category updated");
  });

  classify = asyncHandler(async (req, res) => {
    const item = await this.itemsService.classifyItem(req.params.id!, req.user!.businessId);
    sendSuccess(res, item, "Item classified");
  });

  classifyBatch = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ClassifyBatchQuery;
    const result = await this.itemsService.classifyUnclassified(req.user!.businessId, query.limit ?? 10);
    sendSuccess(res, result, `Classified ${result.classified} item(s)`);
  });
}
