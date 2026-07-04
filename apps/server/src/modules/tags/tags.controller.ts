import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { TagsService } from "./tags.service.js";
import type { CreateTagBody, UpdateTagBody } from "./tags.validation.js";

export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  list = asyncHandler(async (_req, res) => {
    const tags = await this.tagsService.list();
    sendSuccess(res, tags, "Tags retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateTagBody;
    const tag = await this.tagsService.create(body);
    sendSuccess(res, tag, "Tag created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateTagBody;
    const tag = await this.tagsService.update(req.params.id!, body);
    sendSuccess(res, tag, "Tag updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.tagsService.delete(req.params.id!);
    sendSuccess(res, null, "Tag deleted");
  });
}
