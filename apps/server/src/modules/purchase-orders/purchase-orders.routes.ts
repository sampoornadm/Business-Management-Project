import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { PurchaseOrdersController } from "./purchase-orders.controller.js";
import {
  createGoodsReceiptSchema,
  createPurchaseOrderFromRfqSchema,
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderStatusSchema,
  upsertVendorRatingSchema,
} from "./purchase-orders.validation.js";

export function createPurchaseOrdersRouter(controller: PurchaseOrdersController): Router {
  const router = Router();

  /**
   * @openapi
   * /purchase-orders:
   *   get:
   *     tags: [Purchase Orders]
   *     summary: List purchase orders (paginated, filterable by status/vendor/tender)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated purchase orders }
   *   post:
   *     tags: [Purchase Orders]
   *     summary: Create a purchase order with manual line items
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Purchase order created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("purchase_orders:read"),
    validate(listPurchaseOrdersQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("purchase_orders:create"),
    validate(createPurchaseOrderSchema),
    controller.create,
  );

  /**
   * @openapi
   * /purchase-orders/from-rfq:
   *   post:
   *     tags: [Purchase Orders]
   *     summary: Create a purchase order from an awarded RFQ (copies the awarded vendor's quoted rates)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Purchase order created }
   */
  router.post(
    "/from-rfq",
    authenticateMiddleware,
    requirePermission("purchase_orders:create"),
    validate(createPurchaseOrderFromRfqSchema),
    controller.createFromRfq,
  );

  /**
   * @openapi
   * /purchase-orders/{id}:
   *   get:
   *     tags: [Purchase Orders]
   *     summary: Get a purchase order by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Purchase order }
   */
  router.get(
    "/:id",
    authenticateMiddleware,
    requirePermission("purchase_orders:read"),
    controller.getById,
  );

  /**
   * @openapi
   * /purchase-orders/{id}/status:
   *   patch:
   *     tags: [Purchase Orders]
   *     summary: Issue or cancel a purchase order (PARTIALLY_RECEIVED/RECEIVED are server-derived, not settable here)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Purchase order status updated }
   */
  router.patch(
    "/:id/status",
    authenticateMiddleware,
    requirePermission("purchase_orders:update"),
    validate(updatePurchaseOrderStatusSchema),
    controller.updateStatus,
  );

  /**
   * @openapi
   * /purchase-orders/{id}/goods-receipts:
   *   post:
   *     tags: [Purchase Orders]
   *     summary: Record a goods receipt (partial or full) against this purchase order
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Goods receipt recorded }
   */
  router.post(
    "/:id/goods-receipts",
    authenticateMiddleware,
    requirePermission("purchase_orders:receive"),
    validate(createGoodsReceiptSchema),
    controller.createGoodsReceipt,
  );

  /**
   * @openapi
   * /purchase-orders/{id}/vendor-rating:
   *   put:
   *     tags: [Purchase Orders]
   *     summary: Rate the vendor for this purchase order (only once fully received)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Vendor rated }
   */
  router.put(
    "/:id/vendor-rating",
    authenticateMiddleware,
    requirePermission("purchase_orders:update"),
    validate(upsertVendorRatingSchema),
    controller.upsertVendorRating,
  );

  return router;
}
