import { Router } from "express";

import { GENERIC_UPLOAD_LIMITS, TENDER_EXTRACTION_UPLOAD_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { requirePermission } from "../../shared/middleware/requirePermission.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";
import { createUploadMiddleware } from "../attachments/upload.middleware.js";

import type { TendersController } from "./tenders.controller.js";
import {
  addAssigneeSchema,
  changeTenderStatusSchema,
  createCompetitorSchema,
  createTenderSchema,
  listTendersQuerySchema,
  setTenderTagsSchema,
  updateCompetitorSchema,
  updateTenderSchema,
  uploadTenderDocumentSchema,
} from "./tenders.validation.js";

export function createTendersRouter(controller: TendersController): Router {
  const router = Router();
  const uploadDocument = createUploadMiddleware(
    "file",
    GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );
  const uploadForExtraction = createUploadMiddleware(
    "file",
    TENDER_EXTRACTION_UPLOAD_LIMITS.MAX_SIZE_BYTES,
    TENDER_EXTRACTION_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
  );

  /**
   * @openapi
   * /tenders:
   *   get:
   *     tags: [Tenders]
   *     summary: List tenders (paginated, filterable, searchable)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated tenders }
   *   post:
   *     tags: [Tenders]
   *     summary: Create a tender
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Tender created }
   */
  router.get(
    "/",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    validate(listTendersQuerySchema, "query"),
    controller.list,
  );
  router.post(
    "/",
    authenticateMiddleware,
    requirePermission("tenders:create"),
    validate(createTenderSchema),
    controller.create,
  );

  /**
   * @openapi
   * /tenders/extract:
   *   post:
   *     tags: [Tenders]
   *     summary: Extract tender fields from an uploaded document (PDF/DOCX) via a local LLM — preview only, nothing is persisted
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *     responses:
   *       200: { description: Extracted field preview }
   */
  router.post(
    "/extract",
    authenticateMiddleware,
    requirePermission("tenders:create"),
    uploadForExtraction,
    controller.extractFromDocument,
  );

  /**
   * @openapi
   * /tenders/dashboard-stats:
   *   get:
   *     tags: [Tenders]
   *     summary: Get tender counts by status, pending-approval count, and upcoming deadlines
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Dashboard stats }
   */
  router.get(
    "/dashboard-stats",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.dashboardStats,
  );

  /**
   * @openapi
   * /tenders/{id}:
   *   get:
   *     tags: [Tenders]
   *     summary: Get a tender by id
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tender }
   *   patch:
   *     tags: [Tenders]
   *     summary: Update a tender's details
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tender updated }
   *   delete:
   *     tags: [Tenders]
   *     summary: Delete a tender (only allowed while status is Draft)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tender deleted }
   */
  router.get("/:id", authenticateMiddleware, requirePermission("tenders:read"), controller.getById);
  router.patch(
    "/:id",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    validate(updateTenderSchema),
    controller.update,
  );
  router.delete("/:id", authenticateMiddleware, requirePermission("tenders:delete"), controller.deleteById);

  /**
   * @openapi
   * /tenders/{id}/status:
   *   patch:
   *     tags: [Tenders]
   *     summary: Transition a tender to a new status
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Status updated }
   */
  router.patch(
    "/:id/status",
    authenticateMiddleware,
    requirePermission("tenders:change_status"),
    validate(changeTenderStatusSchema),
    controller.changeStatus,
  );

  /**
   * @openapi
   * /tenders/{id}/status-history:
   *   get:
   *     tags: [Tenders]
   *     summary: Get a tender's status change history
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Paginated status history }
   */
  router.get(
    "/:id/status-history",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.statusHistory,
  );

  /**
   * @openapi
   * /tenders/{id}/assignees:
   *   get:
   *     tags: [Tenders]
   *     summary: List staff assigned to a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: List of assignees }
   *   post:
   *     tags: [Tenders]
   *     summary: Assign a staff member to a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Assignee added }
   */
  router.get(
    "/:id/assignees",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.listAssignees,
  );
  router.post(
    "/:id/assignees",
    authenticateMiddleware,
    requirePermission("tenders:assign"),
    validate(addAssigneeSchema),
    controller.addAssignee,
  );

  /**
   * @openapi
   * /tenders/{id}/assignees/{userId}:
   *   delete:
   *     tags: [Tenders]
   *     summary: Remove a staff member from a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: userId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Assignee removed }
   */
  router.delete(
    "/:id/assignees/:userId",
    authenticateMiddleware,
    requirePermission("tenders:assign"),
    controller.removeAssignee,
  );

  /**
   * @openapi
   * /tenders/{id}/competitors:
   *   post:
   *     tags: [Tenders]
   *     summary: Add a competitor record to a tender
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       201: { description: Competitor added }
   */
  router.post(
    "/:id/competitors",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    validate(createCompetitorSchema),
    controller.addCompetitor,
  );

  /**
   * @openapi
   * /tenders/{id}/competitors/{competitorId}:
   *   patch:
   *     tags: [Tenders]
   *     summary: Update a competitor record
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: competitorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Competitor updated }
   *   delete:
   *     tags: [Tenders]
   *     summary: Delete a competitor record
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: competitorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Competitor deleted }
   */
  router.patch(
    "/:id/competitors/:competitorId",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    validate(updateCompetitorSchema),
    controller.updateCompetitor,
  );
  router.delete(
    "/:id/competitors/:competitorId",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    controller.deleteCompetitor,
  );

  /**
   * @openapi
   * /tenders/{id}/tags:
   *   put:
   *     tags: [Tenders]
   *     summary: Replace a tender's tag list
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Tags updated }
   */
  router.put(
    "/:id/tags",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    validate(setTenderTagsSchema),
    controller.setTags,
  );

  /**
   * @openapi
   * /tenders/{id}/documents:
   *   get:
   *     tags: [Tenders]
   *     summary: List a tender's current documents (optionally filtered by documentType)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: List of documents }
   *   post:
   *     tags: [Tenders]
   *     summary: Upload a tender document (or a new version of an existing one)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               file: { type: string, format: binary }
   *               documentType: { type: string }
   *               replacesAttachmentId: { type: string }
   *     responses:
   *       201: { description: Document uploaded }
   */
  router.get(
    "/:id/documents",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.listDocuments,
  );
  router.post(
    "/:id/documents",
    authenticateMiddleware,
    requirePermission("tenders:update"),
    uploadDocument,
    validate(uploadTenderDocumentSchema),
    controller.uploadDocument,
  );

  /**
   * @openapi
   * /tenders/{id}/documents/{documentGroupId}/versions:
   *   get:
   *     tags: [Tenders]
   *     summary: List all versions of a tender document
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: documentGroupId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: List of document versions }
   */
  router.get(
    "/:id/documents/:documentGroupId/versions",
    authenticateMiddleware,
    requirePermission("tenders:read"),
    controller.listDocumentVersions,
  );

  /**
   * @openapi
   * /tenders/{id}/documents/{documentGroupId}:
   *   delete:
   *     tags: [Tenders]
   *     summary: Delete a tender document and all of its versions
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: documentGroupId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Document deleted }
   */
  router.delete(
    "/:id/documents/:documentGroupId",
    authenticateMiddleware,
    requirePermission("attachments:delete"),
    controller.deleteDocument,
  );

  return router;
}
