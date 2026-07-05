import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { TenderExtractionService } from "./tender-extraction.service.js";
import type { TendersService } from "./tenders.service.js";
import type {
  AddAssigneeBody,
  ChangeTenderStatusBody,
  CreateCompetitorBody,
  CreateTenderBody,
  ListTendersQueryParsed,
  SetTenderTagsBody,
  UpdateCompetitorBody,
  UpdateTenderBody,
  UploadTenderDocumentBody,
} from "./tenders.validation.js";

export class TendersController {
  constructor(
    private readonly tendersService: TendersService,
    private readonly tenderExtractionService: TenderExtractionService,
  ) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListTendersQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.tendersService.listTenders(pagination, query);
    sendSuccess(res, result, "Tenders retrieved");
  });

  dashboardStats = asyncHandler(async (_req, res) => {
    const stats = await this.tendersService.getDashboardStats();
    sendSuccess(res, stats, "Dashboard stats retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const tender = await this.tendersService.getById(req.params.id!);
    sendSuccess(res, tender, "Tender retrieved");
  });

  extractFromDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const result = await this.tenderExtractionService.extractFromDocument(
      req.file.buffer,
      req.file.mimetype,
    );
    sendSuccess(res, result, "Fields extracted from document");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateTenderBody;
    const tender = await this.tendersService.create(
      { ...body, createdById: req.user!.id },
      { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    );
    sendSuccess(res, tender, "Tender created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateTenderBody;
    const tender = await this.tendersService.update(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, tender, "Tender updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.tendersService.delete(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "Tender deleted");
  });

  changeStatus = asyncHandler(async (req, res) => {
    const body = req.body as ChangeTenderStatusBody;
    const tender = await this.tendersService.changeStatus(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, tender, "Tender status updated");
  });

  statusHistory = asyncHandler(async (req, res) => {
    const pagination = resolvePagination(req.query as { page?: number; pageSize?: number });
    const history = await this.tendersService.getStatusHistory(req.params.id!, pagination);
    sendSuccess(res, history, "Status history retrieved");
  });

  listAssignees = asyncHandler(async (req, res) => {
    const tender = await this.tendersService.getById(req.params.id!);
    sendSuccess(res, tender.assignees, "Assignees retrieved");
  });

  addAssignee = asyncHandler(async (req, res) => {
    const body = req.body as AddAssigneeBody;
    const tender = await this.tendersService.addAssignee(req.params.id!, body, req.user!.id);
    sendSuccess(res, tender, "Assignee added", 201);
  });

  removeAssignee = asyncHandler(async (req, res) => {
    const tender = await this.tendersService.removeAssignee(
      req.params.id!,
      req.params.userId!,
      req.user!.id,
    );
    sendSuccess(res, tender, "Assignee removed");
  });

  addCompetitor = asyncHandler(async (req, res) => {
    const body = req.body as CreateCompetitorBody;
    const tender = await this.tendersService.addCompetitor(req.params.id!, body, req.user!.id);
    sendSuccess(res, tender, "Competitor added", 201);
  });

  updateCompetitor = asyncHandler(async (req, res) => {
    const body = req.body as UpdateCompetitorBody;
    const tender = await this.tendersService.updateCompetitor(
      req.params.id!,
      req.params.competitorId!,
      body,
      req.user!.id,
    );
    sendSuccess(res, tender, "Competitor updated");
  });

  deleteCompetitor = asyncHandler(async (req, res) => {
    const tender = await this.tendersService.deleteCompetitor(
      req.params.id!,
      req.params.competitorId!,
      req.user!.id,
    );
    sendSuccess(res, tender, "Competitor deleted");
  });

  setTags = asyncHandler(async (req, res) => {
    const body = req.body as SetTenderTagsBody;
    const tender = await this.tendersService.setTags(req.params.id!, body.tagIds, req.user!.id);
    sendSuccess(res, tender, "Tags updated");
  });

  listDocuments = asyncHandler(async (req, res) => {
    const documentType = req.query.documentType as string | undefined;
    const documents = await this.tendersService.listDocuments(req.params.id!, documentType);
    sendSuccess(res, documents, "Documents retrieved");
  });

  uploadDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const body = req.body as UploadTenderDocumentBody;
    const document = await this.tendersService.uploadDocument(
      req.params.id!,
      { buffer: req.file.buffer, originalName: req.file.originalname, mimeType: req.file.mimetype },
      body.documentType,
      body.replacesAttachmentId,
      req.user!.id,
    );
    sendSuccess(res, document, "Document uploaded", 201);
  });

  listDocumentVersions = asyncHandler(async (req, res) => {
    const versions = await this.tendersService.listDocumentVersions(
      req.params.id!,
      req.params.documentGroupId!,
    );
    sendSuccess(res, versions, "Document versions retrieved");
  });
}
