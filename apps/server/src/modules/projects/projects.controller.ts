import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { ProjectsService } from "./projects.service.js";
import type {
  CreateBillBody,
  CreateLaborEntryBody,
  CreateMaterialUsageBody,
  CreateMilestoneBody,
  CreateProjectFromTenderBody,
  ListProjectsQueryParsed,
  UpdateBillStatusBody,
  UpdateMilestoneBody,
  UpdateProjectBody,
} from "./projects.validation.js";

export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListProjectsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.projectsService.listProjects(pagination, { status: query.status });
    sendSuccess(res, result, "Projects retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const project = await this.projectsService.getById(req.params.id!);
    sendSuccess(res, project, "Project retrieved");
  });

  createFromTender = asyncHandler(async (req, res) => {
    const body = req.body as CreateProjectFromTenderBody;
    const project = await this.projectsService.createFromTender(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, project, "Project created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateProjectBody;
    const project = await this.projectsService.update(req.params.id!, body, req.user!.id);
    sendSuccess(res, project, "Project updated");
  });

  addMilestone = asyncHandler(async (req, res) => {
    const body = req.body as CreateMilestoneBody;
    const project = await this.projectsService.addMilestone(req.params.id!, body, req.user!.id);
    sendSuccess(res, project, "Milestone added", 201);
  });

  updateMilestone = asyncHandler(async (req, res) => {
    const body = req.body as UpdateMilestoneBody;
    const project = await this.projectsService.updateMilestone(
      req.params.id!,
      req.params.milestoneId!,
      body,
      req.user!.id,
    );
    sendSuccess(res, project, "Milestone updated");
  });

  deleteMilestone = asyncHandler(async (req, res) => {
    const project = await this.projectsService.deleteMilestone(
      req.params.id!,
      req.params.milestoneId!,
      req.user!.id,
    );
    sendSuccess(res, project, "Milestone deleted");
  });

  addMaterialUsage = asyncHandler(async (req, res) => {
    const body = req.body as CreateMaterialUsageBody;
    const usages = await this.projectsService.addMaterialUsage(req.params.id!, body, req.user!.id);
    sendSuccess(res, usages, "Material usage recorded", 201);
  });

  listMaterialUsages = asyncHandler(async (req, res) => {
    const usages = await this.projectsService.listMaterialUsages(req.params.id!);
    sendSuccess(res, usages, "Material usages retrieved");
  });

  addLaborEntry = asyncHandler(async (req, res) => {
    const body = req.body as CreateLaborEntryBody;
    const entries = await this.projectsService.addLaborEntry(req.params.id!, body, req.user!.id);
    sendSuccess(res, entries, "Labor entry recorded", 201);
  });

  listLaborEntries = asyncHandler(async (req, res) => {
    const entries = await this.projectsService.listLaborEntries(req.params.id!);
    sendSuccess(res, entries, "Labor entries retrieved");
  });

  addBill = asyncHandler(async (req, res) => {
    const body = req.body as CreateBillBody;
    const bills = await this.projectsService.addBill(req.params.id!, body, req.user!.id);
    sendSuccess(res, bills, "Bill created", 201);
  });

  listBills = asyncHandler(async (req, res) => {
    const bills = await this.projectsService.listBills(req.params.id!);
    sendSuccess(res, bills, "Bills retrieved");
  });

  updateBillStatus = asyncHandler(async (req, res) => {
    const body = req.body as UpdateBillStatusBody;
    const bills = await this.projectsService.updateBillStatus(
      req.params.id!,
      req.params.billId!,
      body.status,
      req.user!.id,
    );
    sendSuccess(res, bills, "Bill status updated");
  });

  getCosting = asyncHandler(async (req, res) => {
    const costing = await this.projectsService.getCosting(req.params.id!);
    sendSuccess(res, costing, "Project costing retrieved");
  });

  getProgress = asyncHandler(async (req, res) => {
    const progress = await this.projectsService.getProgress(req.params.id!);
    sendSuccess(res, progress, "Project progress retrieved");
  });
}
