import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { IPortalBidRepository } from "./portal-bid.repository.js";

export class PortalBidController {
  constructor(private readonly portalBids: IPortalBidRepository) {}

  getByResponseNumber = asyncHandler(async (req, res) => {
    const bid = await this.portalBids.findByResponseNumber(
      req.user!.businessId,
      "SAIL_ISP",
      req.params.responseNumber!,
    );
    if (!bid) throw new NotFoundError("No bid was filed under that response number");
    sendSuccess(res, bid, "Portal bid retrieved");
  });
}
