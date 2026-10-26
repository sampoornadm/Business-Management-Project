import { prisma } from "../../infra/prisma/client.js";
import { boqRepository } from "../boq/boq.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { BidPayloadService } from "./bid-payload.service.js";
import { PortalBidController } from "./portal-bid.controller.js";
import { PortalBidRepository, PortalProfileRepository } from "./portal-bid.repository.js";
import { createPortalBidRouter } from "./portal-bid.routes.js";

export const portalBidRepository = new PortalBidRepository(prisma);
export const portalProfileRepository = new PortalProfileRepository(prisma);
export const bidPayloadService = new BidPayloadService({
  tenders: tendersRepository,
  boqs: boqRepository,
  businesses: businessesRepository,
  portalProfiles: portalProfileRepository,
});

export const portalBidRouter = createPortalBidRouter(new PortalBidController(portalBidRepository));
