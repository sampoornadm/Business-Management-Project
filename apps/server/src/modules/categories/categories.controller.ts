import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { CategoriesService } from "./categories.service.js";
import type { CreateCategoryBody, UpdateCategoryBody } from "./categories.validation.js";

export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  tree = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.categoriesService.getTree(), "Categories retrieved");
  });

  leaves = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.categoriesService.getLeaves(), "Category leaves retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateCategoryBody;
    const tree = await this.categoriesService.create(body);
    sendSuccess(res, tree, "Category created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateCategoryBody;
    const tree = await this.categoriesService.update(req.params.id!, body);
    sendSuccess(res, tree, "Category updated");
  });

  remove = asyncHandler(async (req, res) => {
    const tree = await this.categoriesService.delete(req.params.id!);
    sendSuccess(res, tree, "Category deleted");
  });
}
