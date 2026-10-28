import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";
import { boqRepository } from "../boq/boq.module.js";
import { businessesRepository } from "../businesses/businesses.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { BidPayloadService } from "./bid-payload.service.js";
import { defaultProfileDir, PortalBrowser } from "./portal/portal-browser.js";
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


// The browser window the user logs into the portal with. It is launched by this process, so it
// only exists where the server runs on a desktop (not inside Docker).
export const portalBrowser = new PortalBrowser({
  profileDir: env.PORTAL_BROWSER_DIR ?? defaultProfileDir(),
  portalUrl: env.PORTAL_URL,
  executablePath: env.PORTAL_BROWSER_PATH,
});

const NO_RESPONSE_OPEN = "Open the portal browser, log in, and open the bid response first";

/** The bundled browser's open response; else a Chrome started by hand when PORTAL_CDP_URL is set. */
async function attachToPortal() {
  const managed = await portalBrowser.session();
  if (managed) return managed;
  if (!env.PORTAL_CDP_URL) throw new Error(NO_RESPONSE_OPEN);
  return PortalSession.attach(env.PORTAL_CDP_URL).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(/ECONNREFUSED|connect/i.test(message) && !/SAIL ISP/.test(message) ? NO_RESPONSE_OPEN : message);
  });
}

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
    attach: attachToPortal,
  }),
);

export const portalBidRouter = createPortalBidRouter(
  new PortalBidController(portalBidRepository, portalProfileService, portalFillService, portalBrowser),
);
