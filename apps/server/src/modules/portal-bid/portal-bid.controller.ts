import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { PortalBrowser } from "./portal/portal-browser.js";
import type { IPortalBidRepository } from "./portal-bid.repository.js";
import type { PortalFillService } from "./portal-fill.service.js";
import type { PortalProfileService } from "./portal-profile.service.js";

export class PortalBidController {
  constructor(
    private readonly portalBids: IPortalBidRepository,
    private readonly profiles: PortalProfileService,
    private readonly fills: PortalFillService,
    private readonly browser: PortalBrowser,
  ) {}

  getByResponseNumber = asyncHandler(async (req, res) => {
    const bid = await this.portalBids.findByResponseNumber(
      req.user!.businessId,
      "SAIL_ISP",
      req.params.responseNumber!,
    );
    if (!bid) throw new NotFoundError("No bid was filed under that response number");
    sendSuccess(res, bid, "Portal bid retrieved");
  });

  getProfile = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.profiles.get(req.user!.businessId), "Portal profile retrieved");
  });

  updateProfile = asyncHandler(async (req, res) => {
    const profile = await this.profiles.update(req.user!.businessId, req.user!.id, req.body.answers);
    sendSuccess(res, profile, "Portal profile updated");
  });

  startFill = asyncHandler(async (req, res) => {
    const job = this.fills.start(req.params.tenderId!, req.user!.businessId, req.user!.id);
    sendSuccess(res, job, "Portal fill started", 202);
  });

  getFillJob = asyncHandler(async (req, res) => {
    sendSuccess(res, this.fills.get(req.params.jobId!, req.user!.businessId), "Portal fill status retrieved");
  });

  openBrowser = asyncHandler(async (_req, res) => {
    await this.browser.open();
    sendSuccess(res, await this.browser.status(), "Portal browser opened");
  });

  getBrowserStatus = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.browser.status(), "Portal browser status retrieved");
  });
}
