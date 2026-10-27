import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { boqRepository } from "../boq/boq.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { BidPayloadService } from "./bid-payload.service.js";
import { PortalSession } from "./portal/portal-session.js";
import { PortalBidController } from "./portal-bid.controller.js";
import { PortalBidRepository, PortalProfileRepository } from "./portal-bid.repository.js";
import { createPortalBidRouter } from "./portal-bid.routes.js";
import { PortalFillService, createPortalFillRunner } from "./portal-fill.service.js";
import { PortalProfileService } from "./portal-profile.service.js";

export const portalBidRepository = new PortalBidRepository(prisma);
export const portalProfileRepository = new PortalProfileRepository(prisma);
export const bidPayloadService = new BidPayloadService({
  tenders: tendersRepository,
  boqs: boqRepository,
  businesses: businessesRepository,
  portalProfiles: portalProfileRepository,
});


// The Chrome the user logged into the portal with, started with --remote-debugging-port.
const PORTAL_CDP_URL = process.env.PORTAL_CDP_URL ?? "http://127.0.0.1:9222";

const portalProfileService = new PortalProfileService({
  businesses: businessesRepository,
  portalProfiles: portalProfileRepository,
  audit: auditService,
});
const portalFillService = new PortalFillService(
  createPortalFillRunner({
    tenders: tendersRepository,
    payloads: bidPayloadService,
    portalBids: portalBidRepository,
    audit: auditService,
    attach: (cdpUrl) => PortalSession.attach(cdpUrl),
    cdpUrl: PORTAL_CDP_URL,
  }),
);

export const portalBidRouter = createPortalBidRouter(
  new PortalBidController(portalBidRepository, portalProfileService, portalFillService),
);
