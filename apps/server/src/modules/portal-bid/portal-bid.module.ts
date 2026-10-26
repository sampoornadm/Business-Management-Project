import { prisma } from "../../infra/prisma/client.js";
import { boqRepository } from "../boq/boq.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { BidPayloadService } from "./bid-payload.service.js";
import { PortalBidRepository, PortalProfileRepository } from "./portal-bid.repository.js";

export const portalBidRepository = new PortalBidRepository(prisma);
export const portalProfileRepository = new PortalProfileRepository(prisma);
export const bidPayloadService = new BidPayloadService({
  tenders: tendersRepository,
  boqs: boqRepository,
  businesses: businessesRepository,
  portalProfiles: portalProfileRepository,
});
