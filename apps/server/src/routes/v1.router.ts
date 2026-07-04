import { Router } from "express";

import { attachmentsRouter } from "../modules/attachments/attachments.module.js";
import { auditRouter } from "../modules/audit/audit.module.js";
import { authRouter } from "../modules/auth/auth.module.js";
import { boqItemsRouter, boqRouter } from "../modules/boq/boq.module.js";
import {
  bankAccountsRouter,
  expensesRouter,
  financeReportsRouter,
  invoicesRouter,
  purchaseOrderPaymentsRouter,
} from "../modules/finance/finance.module.js";
import { notificationsRouter } from "../modules/notifications/notifications.module.js";
import { organizationsRouter } from "../modules/organizations/organizations.module.js";
import { permissionsRouter } from "../modules/permissions/permissions.module.js";
import { projectsRouter } from "../modules/projects/projects.module.js";
import { purchaseOrdersRouter } from "../modules/purchase-orders/purchase-orders.module.js";
import { ratesRouter } from "../modules/rates/rates.module.js";
import { reportsRouter, searchRouter } from "../modules/reports/reports.module.js";
import { rfqItemsRouter, rfqRouter } from "../modules/rfq/rfq.module.js";
import { rolesRouter } from "../modules/roles/roles.module.js";
import { tagsRouter } from "../modules/tags/tags.module.js";
import { tendersRouter } from "../modules/tenders/tenders.module.js";
import { usersRouter } from "../modules/users/users.module.js";
import { vendorsRouter } from "../modules/vendors/vendors.module.js";

import { healthRouter } from "./health.js";

export const v1Router = Router();

v1Router.use("/health", healthRouter);
v1Router.use("/auth", authRouter);
v1Router.use("/users", usersRouter);
v1Router.use("/roles", rolesRouter);
v1Router.use("/permissions", permissionsRouter);
v1Router.use("/attachments", attachmentsRouter);
v1Router.use("/audit-logs", auditRouter);
v1Router.use("/organizations", organizationsRouter);
v1Router.use("/tags", tagsRouter);
v1Router.use("/notifications", notificationsRouter);
v1Router.use("/tenders", tendersRouter);
v1Router.use("/tenders", boqRouter);
v1Router.use("/boq-items", boqItemsRouter);
v1Router.use("/rates", ratesRouter);
v1Router.use("/vendors", vendorsRouter);
v1Router.use("/rfqs", rfqRouter);
v1Router.use("/rfq-items", rfqItemsRouter);
v1Router.use("/purchase-orders", purchaseOrdersRouter);
v1Router.use("/purchase-orders", purchaseOrderPaymentsRouter);
v1Router.use("/projects", projectsRouter);
v1Router.use("/bank-accounts", bankAccountsRouter);
v1Router.use("/invoices", invoicesRouter);
v1Router.use("/expenses", expensesRouter);
v1Router.use("/finance", financeReportsRouter);
v1Router.use("/reports", reportsRouter);
v1Router.use("/search", searchRouter);
