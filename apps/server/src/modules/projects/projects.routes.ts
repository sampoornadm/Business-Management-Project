import { Router } from "express";

import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { ProjectsController } from "./projects.controller.js";
import {
  createBillSchema,
  createLaborEntrySchema,
  createMaterialUsageSchema,
  createMilestoneSchema,
  createProjectFromTenderSchema,
  listProjectsQuerySchema,
  updateBillStatusSchema,
  updateMilestoneSchema,
  updateProjectSchema,
} from "./projects.validation.js";

export function createProjectsRouter(controller: ProjectsController): Router {
  const router = Router();

  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("projects:read"),
    validate(listProjectsQuerySchema, "query"),
    controller.list,
  );

  /**
   * @openapi
   * /projects/from-tender:
   *   post:
   *     tags: [Projects]
   *     summary: Convert a WON tender into a project
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Project created }
   */
  router.post(
    "/from-tender",
    authenticateMiddleware,
    requirePermission("projects:create"),
    validate(createProjectFromTenderSchema),
    controller.createFromTender,
  );

  router.get("/:id", authenticateMiddleware, requirePermission("projects:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(updateProjectSchema),
    controller.update,
  );

  router.post(
    "/:id/milestones",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(createMilestoneSchema),
    controller.addMilestone,
  );
  router.patch(
    "/:id/milestones/:milestoneId",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(updateMilestoneSchema),
    controller.updateMilestone,
  );
  router.delete(
    "/:id/milestones/:milestoneId",
    authenticateMiddleware,
    requirePermission("projects:update"),
    controller.deleteMilestone,
  );

  router.get(
    "/:id/material-usage",
    authenticateMiddleware,
    requirePermission("projects:read"),
    controller.listMaterialUsages,
  );
  router.post(
    "/:id/material-usage",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(createMaterialUsageSchema),
    controller.addMaterialUsage,
  );

  router.get(
    "/:id/labor-entries",
    authenticateMiddleware,
    requirePermission("projects:read"),
    controller.listLaborEntries,
  );
  router.post(
    "/:id/labor-entries",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(createLaborEntrySchema),
    controller.addLaborEntry,
  );

  router.get("/:id/bills", authenticateMiddleware, requirePermission("projects:read"), controller.listBills);
  router.post(
    "/:id/bills",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(createBillSchema),
    controller.addBill,
  );
  router.patch(
    "/:id/bills/:billId/status",
    authenticateMiddleware,
    requirePermission("projects:update"),
    validate(updateBillStatusSchema),
    controller.updateBillStatus,
  );

  router.get(
    "/:id/costing",
    authenticateMiddleware,
    requirePermission("projects:read"),
    controller.getCosting,
  );
  router.get(
    "/:id/progress",
    authenticateMiddleware,
    requirePermission("projects:read"),
    controller.getProgress,
  );

  return router;
}
