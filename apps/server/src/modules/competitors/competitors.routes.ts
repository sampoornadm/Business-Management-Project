import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { CompetitorsController } from "./competitors.controller.js";
import {
  competitorIdParamsSchema,
  itemCodeParamsSchema,
  listItemsQuerySchema,
  tenderIdParamsSchema,
  updateCompetitorSchema,
} from "./competitors.validation.js";

export function createCompetitorsRouter(controller: CompetitorsController): Router {
  const router = Router();

  /**
   * @openapi
   * /competitors:
   *   get:
   *     tags: [Competitors]
   *     summary: Firms met as bidders in the client portal's comparative statements
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Each competitor with tenders met and times it was the lowest overall bidder }
   */
  router.get("/", authenticateMiddleware, requirePermission("competitors:read"), controller.list);

  /**
   * @openapi
   * /competitors/items:
   *   get:
   *     tags: [Competitors]
   *     summary: Items for which competitor rates are stored
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: search, schema: { type: string } }
   *     responses:
   *       200: { description: "Item code, description, competitor count and tender count" }
   * /competitors/items/{itemCode}:
   *   get:
   *     tags: [Competitors]
   *     summary: Every bidder's basic rate for one item, side by side, one row per tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: itemCode, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: "Columns (our firm first) with trend and predicted rate, rows per tender" }
   *       404: { description: No competitor has quoted this item }
   */
  router.get(
    "/items",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(listItemsQuerySchema, "query"),
    controller.listItems,
  );
  router.get(
    "/items/:itemCode",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(itemCodeParamsSchema, "params"),
    controller.getItemComparison,
  );

  /**
   * @openapi
   * /competitors/tenders/{tenderId}/rates-to-beat:
   *   get:
   *     tags: [Competitors]
   *     summary: Per BOQ item of a tender, the likely bidders and the rate to beat
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: tenderId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: Rate to beat per item code (null without history) and likely bidders }
   *       404: { description: No such tender in this business }
   */
  router.get(
    "/tenders/:tenderId/rates-to-beat",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(tenderIdParamsSchema, "params"),
    controller.getRatesToBeat,
  );

  /**
   * @openapi
   * /competitors/tenders/{tenderId}/fetch-statement:
   *   post:
   *     tags: [Competitors]
   *     summary: Read a submitted tender's comparative statement from the portal browser window and save it
   *     description: "Uses the portal login already in that window; never logs in itself. Replaces a statement saved earlier. A Submitted tender moves to Price opened; Won/Lost is never set here."
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: tenderId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: "Bidder and item counts, the lowest overall bidder, and whether our own bid was found" }
   *       400: { description: "The tender has not been submitted, or the statement is for another RFx" }
   *       409: { description: "The portal needs a login, or the statement is not available yet. Nothing was saved" }
   *       422: { description: The page could not be read as a comparative statement. Nothing was saved }
   */
  /**
   * @openapi
   * /competitors/tenders/{tenderId}/standing:
   *   get:
   *     tags: [Competitors]
   *     summary: Our rank by total quote in a tender's price opening, and the lowest bidder
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: tenderId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: "The standing, or null when no comparative statement has been fetched" }
   */
  router.get(
    "/tenders/:tenderId/standing",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(tenderIdParamsSchema, "params"),
    controller.getStanding,
  );

  /**
   * @openapi
   * /competitors/tenders/{tenderId}/statement:
   *   get:
   *     tags: [Competitors]
   *     summary: A tender's stored comparative statement as one table
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: tenderId, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: "Bidders (our bid first) and items in the tender's order with each bidder's basic rate; null when none is stored" }
   */
  router.get(
    "/tenders/:tenderId/statement",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(tenderIdParamsSchema, "params"),
    controller.getStatement,
  );

  router.post(
    "/tenders/:tenderId/fetch-statement",
    authenticateMiddleware,
    requirePermission("tenders:fill_portal"),
    validate(tenderIdParamsSchema, "params"),
    controller.fetchStatement,
  );

  /**
   * @openapi
   * /competitors/{id}:
   *   get:
   *     tags: [Competitors]
   *     summary: One competitor, the items it quoted and its rate in each tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: "Items with per-tender rates, rank, trend and predicted next rate" }
   *       404: { description: No such competitor in this business }
   *   patch:
   *     tags: [Competitors]
   *     summary: Mark (or unmark) a portal vendor as our own firm
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
   *     responses:
   *       200: { description: The updated competitor }
   */
  router.get(
    "/:id",
    authenticateMiddleware,
    requirePermission("competitors:read"),
    validate(competitorIdParamsSchema, "params"),
    controller.getById,
  );
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("tenders:fill_portal"),
    validate(competitorIdParamsSchema, "params"),
    validate(updateCompetitorSchema),
    controller.update,
  );

  return router;
}
