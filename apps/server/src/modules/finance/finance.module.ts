import { prisma } from "../../infra/prisma/client.js";
import { auditService } from "../audit/audit.module.js";

import { FinanceController } from "./finance.controller.js";
import { FinanceRepository } from "./finance.repository.js";
import {
  createBankAccountsRouter,
  createExpensesRouter,
  createFinanceReportsRouter,
  createInvoicesRouter,
  createPurchaseOrderPaymentsRouter,
} from "./finance.routes.js";
import { FinanceService } from "./finance.service.js";

const financeRepository = new FinanceRepository(prisma);
export const financeService = new FinanceService(financeRepository, auditService);
const financeController = new FinanceController(financeService);

export const bankAccountsRouter = createBankAccountsRouter(financeController);
export const invoicesRouter = createInvoicesRouter(financeController);
export const expensesRouter = createExpensesRouter(financeController);
export const purchaseOrderPaymentsRouter = createPurchaseOrderPaymentsRouter(financeController);
export const financeReportsRouter = createFinanceReportsRouter(financeController);
