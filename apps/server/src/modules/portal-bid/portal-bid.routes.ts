import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { PortalBidController } from "./portal-bid.controller.js";
import { fillJobParamsSchema, tenderIdParamsSchema, updatePortalProfileSchema } from "./portal-bid.validation.js";

export function createPortalBidRouter(controller: PortalBidController): Router {
  const router = Router();

  /**
   * @openapi
   * /portal-bids/by-response/{responseNumber}:
   *   get:
   *     tags: [Portal bids]
   *     summary: Find the tender a portal response number was filed for
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: responseNumber, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: The tender id, number and bid status }
   *       404: { description: No bid under that response number }
   */
  router.get(
    "/by-response/:responseNumber",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.getByResponseNumber,
  );

  /**
   * @openapi
   * /portal-bids/profile:
   *   get:
   *     tags: [Portal bids]
   *     summary: The current business's SAIL ISP answer sheet, every question with its value
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: The questions and what the portal will be given for each }
   *   put:
   *     tags: [Portal bids]
   *     summary: Edit the stored SAIL ISP answers (empty text clears one)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: The updated answer sheet }
   *       400: { description: An answer that is not editable in the profile }
   */
  router.get("/profile", authenticateMiddleware, requirePermission("tenders:fill_portal"), controller.getProfile);
  router.put(
    "/profile",
    authenticateMiddleware,
    requirePermission("tenders:fill_portal"),
    validate(updatePortalProfileSchema),
    controller.updateProfile,
  );

  /**
   * @openapi
   * /portal-bids/tenders/{tenderId}/fill:
   *   post:
   *     tags: [Portal bids]
   *     summary: Start filling the open SAIL ISP response for a tender (types only; never saves or submits)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: tenderId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       202: { description: The fill job, poll it for progress }
   *       409: { description: A fill is already running }
   */
  router.post(
    "/tenders/:tenderId/fill",
    authenticateMiddleware,
    requirePermission("tenders:fill_portal"),
    validate(tenderIdParamsSchema, "params"),
    controller.startFill,
  );

  /**
   * @openapi
   * /portal-bids/fill-jobs/{jobId}:
   *   get:
   *     tags: [Portal bids]
   *     summary: Progress and result of a portal fill
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: jobId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: Status, 0-100 progress, and the result when done }
   *       404: { description: No such job in this business }
   */
  router.get(
    "/fill-jobs/:jobId",
    authenticateMiddleware,
    requirePermission("tenders:fill_portal"),
    validate(fillJobParamsSchema, "params"),
    controller.getFillJob,
  );

  /**
   * @openapi
   * /portal-bids/browser/open:
   *   post:
   *     tags: [Portal bids]
   *     summary: Open (or bring forward) the bundled portal browser window on the machine the server runs on
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: The browser status after opening }
   * /portal-bids/browser/status:
   *   get:
   *     tags: [Portal bids]
   *     summary: Whether the portal browser is open and showing a bid response
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: open, onResponsePage and, when on a response, its RFx and response numbers }
   */
  router.post("/browser/open", authenticateMiddleware, requirePermission("tenders:fill_portal"), controller.openBrowser);
  router.get("/browser/status", authenticateMiddleware, requirePermission("tenders:fill_portal"), controller.getBrowserStatus);

  return router;
}
