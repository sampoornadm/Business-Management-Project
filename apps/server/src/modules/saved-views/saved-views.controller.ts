import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { SavedViewsService } from "./saved-views.service.js";
import type {
  CreateSavedViewBody,
  ListSavedViewsQueryParsed,
  UpdateSavedViewBody,
} from "./saved-views.validation.js";

export class SavedViewsController {
  constructor(private readonly savedViewsService: SavedViewsService) {}

  list = asyncHandler(async (req, res) => {
    const { pageKey } = req.query as unknown as ListSavedViewsQueryParsed;
    const views = await this.savedViewsService.list(req.user!.id, req.user!.businessId, pageKey);
    sendSuccess(res, views, "Saved views retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateSavedViewBody;
    const view = await this.savedViewsService.create({
      userId: req.user!.id,
      businessId: req.user!.businessId,
      pageKey: body.pageKey,
      name: body.name,
      filters: body.filters,
      visibleColumns: body.visibleColumns,
      columnOrder: body.columnOrder,
      sortBy: body.sortBy ?? null,
      sortDir: body.sortDir ?? null,
    });
    sendSuccess(res, view, "Saved view created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateSavedViewBody;
    const view = await this.savedViewsService.update(
      req.params.id!,
      req.user!.id,
      req.user!.businessId,
      body,
    );
    sendSuccess(res, view, "Saved view updated");
  });

  remove = asyncHandler(async (req, res) => {
    await this.savedViewsService.delete(req.params.id!, req.user!.id, req.user!.businessId);
    sendSuccess(res, null, "Saved view deleted");
  });
}
