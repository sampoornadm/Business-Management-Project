import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { ReportsController } from "./reports.controller.js";
import {
  exportReportParamsSchema,
  exportReportQuerySchema,
  reportDateRangeQuerySchema,
  searchQuerySchema,
} from "./reports.validation.js";

/** Mounted at /reports */
export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();

  router.get(
    "/tender-pipeline",
    authenticateMiddleware,
    requirePermission("reports:read"),
    controller.getTenderPipeline,
  );
  router.get(
    "/procurement-spend",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(reportDateRangeQuerySchema, "query"),
    controller.getProcurementSpend,
  );
  router.get(
    "/project-costing",
    authenticateMiddleware,
    requirePermission("reports:read"),
    controller.getProjectCosting,
  );
  router.get(
    "/financial-summary",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(reportDateRangeQuerySchema, "query"),
    controller.getFinancialSummary,
  );
  router.get(
    "/vendor-performance",
    authenticateMiddleware,
    requirePermission("reports:read"),
    controller.getVendorPerformance,
  );
  router.get("/kpis", authenticateMiddleware, requirePermission("reports:read"), controller.getKpis);
  router.get(
    "/:reportKey/export",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(exportReportParamsSchema, "params"),
    validate(exportReportQuerySchema, "query"),
    controller.exportReport,
  );

  return router;
}

/** Mounted at /search */
export function createSearchRouter(controller: ReportsController): Router {
  const router = Router();
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("reports:read"),
    validate(searchQuerySchema, "query"),
    controller.search,
  );
  return router;
}
