import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { FinanceController } from "./finance.controller.js";
import {
  createBankAccountSchema,
  createExpenseSchema,
  createInvoiceFromBillSchema,
  createInvoiceSchema,
  createPaymentSchema,
  listExpensesQuerySchema,
  listInvoicesQuerySchema,
  updateBankAccountSchema,
  updateExpenseSchema,
  updateInvoiceSchema,
} from "./finance.validation.js";

/** Mounted at /bank-accounts */
export function createBankAccountsRouter(controller: FinanceController): Router {
  const router = Router();

  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("finance:read"),
    controller.listBankAccounts,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createBankAccountSchema),
    controller.createBankAccount,
  );
  router.get(
    "/:id",
    authenticateMiddleware,
    requirePermission("finance:read"),
    controller.getBankAccount,
  );
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("finance:update"),
    validate(updateBankAccountSchema),
    controller.updateBankAccount,
  );
  router.delete(
    "/:id",
    authenticateMiddleware,
    requirePermission("finance:delete"),
    controller.deleteBankAccount,
  );

  return router;
}

/** Mounted at /invoices */
export function createInvoicesRouter(controller: FinanceController): Router {
  const router = Router();

  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("finance:read"),
    validate(listInvoicesQuerySchema, "query"),
    controller.listInvoices,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createInvoiceSchema),
    controller.createInvoice,
  );
  router.post(
    "/from-bill",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createInvoiceFromBillSchema),
    controller.createInvoiceFromBill,
  );
  router.get("/:id", authenticateMiddleware, requirePermission("finance:read"), controller.getInvoice);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("finance:update"),
    validate(updateInvoiceSchema),
    controller.updateInvoice,
  );
  router.post(
    "/:id/payments",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createPaymentSchema),
    controller.recordInvoicePayment,
  );

  return router;
}

/** Mounted at /expenses */
export function createExpensesRouter(controller: FinanceController): Router {
  const router = Router();

  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("finance:read"),
    validate(listExpensesQuerySchema, "query"),
    controller.listExpenses,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createExpenseSchema),
    controller.createExpense,
  );
  router.get("/:id", authenticateMiddleware, requirePermission("finance:read"), controller.getExpense);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("finance:update"),
    validate(updateExpenseSchema),
    controller.updateExpense,
  );
  router.post(
    "/:id/payments",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createPaymentSchema),
    controller.recordExpensePayment,
  );

  return router;
}

/** Mounted at /purchase-orders (adds payment endpoints alongside the Phase 4 module's own router) */
export function createPurchaseOrderPaymentsRouter(controller: FinanceController): Router {
  const router = Router();

  router.get(
    "/:id/payments",
    authenticateMiddleware,
    requirePermission("finance:read"),
    controller.listPurchaseOrderPayments,
  );
  router.post(
    "/:id/payments",
    authenticateMiddleware,
    requirePermission("finance:create"),
    validate(createPaymentSchema),
    controller.recordPurchaseOrderPayment,
  );

  return router;
}

/** Mounted at /finance */
export function createFinanceReportsRouter(controller: FinanceController): Router {
  const router = Router();

  router.get("/summary", authenticateMiddleware, requirePermission("finance:read"), controller.getSummary);
  router.get("/cash-book", authenticateMiddleware, requirePermission("finance:read"), controller.getCashBook);
  router.get(
    "/bank-book/:bankAccountId",
    authenticateMiddleware,
    requirePermission("finance:read"),
    controller.getBankBook,
  );

  return router;
}
