import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { AssistantService } from "./assistant.service.js";
import type { AssistantQueryBody } from "./assistant.validation.js";

export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  query = asyncHandler(async (req, res) => {
    const body = req.body as AssistantQueryBody;
    const { roleId, businessId } = req.user!;
    const result = await this.assistantService.query(body, { roleId, businessId });
    sendSuccess(res, result, "Assistant response");
  });
}
