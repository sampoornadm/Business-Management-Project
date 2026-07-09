import {
  BILL_STATUS_TRANSITIONS,
  type BillStatus,
  type CreateBillInput,
  type CreateLaborEntryInput,
  type CreateMaterialUsageInput,
  type CreateMilestoneInput,
  type CreateProjectFromTenderInput,
  type PaginatedResult,
  type ProjectCostingDto,
  type ProjectDto,
  type ProjectListItemDto,
  type ProjectProgressDto,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
} from "@bmp/types";

import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import { round2 } from "../../shared/utils/math.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import {
  toBillDto,
  toLaborEntryDto,
  toMaterialUsageDto,
  toProjectDto,
  toProjectListItemDto,
} from "./projects.mapper.js";
import type { IProjectsRepository, ProjectDetail, ProjectFilters } from "./projects.repository.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ProjectsService {
  constructor(
    private readonly projectsRepository: IProjectsRepository,
    private readonly tendersRepository: ITendersRepository,
    private readonly auditService: AuditService,
  ) {}

  private async getDetailOrThrow(id: string): Promise<ProjectDetail> {
    const project = await this.projectsRepository.findById(id);
    if (!project) throw new NotFoundError("Project not found");
    return project;
  }

  async listProjects(
    pagination: PaginationParams,
    filters: ProjectFilters,
  ): Promise<PaginatedResult<ProjectListItemDto>> {
    const { items, totalItems } = await this.projectsRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toProjectListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<ProjectDto> {
    return toProjectDto(await this.getDetailOrThrow(id));
  }

  async createFromTender(
    input: CreateProjectFromTenderInput,
    actorId: string,
    context: RequestContext = {},
  ): Promise<ProjectDto> {
    const tender = await this.tendersRepository.findById(input.tenderId);
    if (!tender) throw new BadRequestError("Invalid tenderId");
    if (tender.status !== "WON") {
      throw new ConflictError("Only a tender with status WON can be converted to a project");
    }

    const existing = await this.projectsRepository.findByTenderId(input.tenderId);
    if (existing) throw new ConflictError("This tender already has a project");

    const budget = input.budget ?? tender.winningBidAmount ?? tender.estimatedCost;
    const projectId = await this.projectsRepository.createFromTender({
      tenderId: input.tenderId,
      name: input.name ?? tender.title,
      budget,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      location: input.location ?? tender.location,
      notes: input.notes,
      createdById: actorId,
    });

    await this.auditService.log({
      actorId,
      action: "PROJECT_CREATED_FROM_TENDER",
      entityType: "Project",
      entityId: projectId,
      metadata: { tenderId: input.tenderId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return this.getById(projectId);
  }

  async update(id: string, data: UpdateProjectInput, actorId: string): Promise<ProjectDto> {
    await this.getDetailOrThrow(id);
    await this.projectsRepository.update(id, {
      name: data.name,
      status: data.status,
      budget: data.budget,
      startDate: data.startDate ? new Date(data.startDate) : undefined,
      endDate: data.endDate ? new Date(data.endDate) : undefined,
      actualEndDate: data.actualEndDate ? new Date(data.actualEndDate) : undefined,
      location: data.location,
      notes: data.notes,
    });
    await this.auditService.log({ actorId, action: "PROJECT_UPDATED", entityType: "Project", entityId: id });
    return this.getById(id);
  }

  async addMilestone(projectId: string, input: CreateMilestoneInput, actorId: string): Promise<ProjectDto> {
    await this.getDetailOrThrow(projectId);
    await this.projectsRepository.createMilestone({
      projectId,
      title: input.title,
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : null,
      weightPercent: input.weightPercent ?? 0,
      sortOrder: input.sortOrder,
    });
    await this.auditService.log({
      actorId,
      action: "PROJECT_MILESTONE_ADDED",
      entityType: "Project",
      entityId: projectId,
    });
    return this.getById(projectId);
  }

  private async assertMilestoneBelongsToProject(projectId: string, milestoneId: string): Promise<void> {
    const milestone = await this.projectsRepository.findMilestoneById(milestoneId);
    if (!milestone || milestone.projectId !== projectId) {
      throw new NotFoundError("Milestone not found for this project");
    }
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
    actorId: string,
  ): Promise<ProjectDto> {
    await this.assertMilestoneBelongsToProject(projectId, milestoneId);
    await this.projectsRepository.updateMilestone(milestoneId, {
      title: input.title,
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined,
      completedDate: input.completedDate
        ? new Date(input.completedDate)
        : input.status === "COMPLETED"
          ? new Date()
          : undefined,
      status: input.status,
      weightPercent: input.weightPercent,
      sortOrder: input.sortOrder,
    });
    await this.auditService.log({
      actorId,
      action: "PROJECT_MILESTONE_UPDATED",
      entityType: "Project",
      entityId: projectId,
      metadata: { milestoneId },
    });
    return this.getById(projectId);
  }

  async deleteMilestone(projectId: string, milestoneId: string, actorId: string): Promise<ProjectDto> {
    await this.assertMilestoneBelongsToProject(projectId, milestoneId);
    await this.projectsRepository.deleteMilestone(milestoneId);
    await this.auditService.log({
      actorId,
      action: "PROJECT_MILESTONE_DELETED",
      entityType: "Project",
      entityId: projectId,
      metadata: { milestoneId },
    });
    return this.getById(projectId);
  }

  async addMaterialUsage(projectId: string, input: CreateMaterialUsageInput, actorId: string) {
    await this.getDetailOrThrow(projectId);
    await this.projectsRepository.createMaterialUsage({
      projectId,
      boqItemId: input.boqItemId,
      materialName: input.materialName,
      unit: input.unit,
      quantityUsed: input.quantityUsed,
      usageDate: input.usageDate ? new Date(input.usageDate) : undefined,
      remarks: input.remarks,
      recordedById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "PROJECT_MATERIAL_USAGE_RECORDED",
      entityType: "Project",
      entityId: projectId,
    });
    return this.listMaterialUsages(projectId);
  }

  async listMaterialUsages(projectId: string) {
    await this.getDetailOrThrow(projectId);
    const usages = await this.projectsRepository.findMaterialUsages(projectId);
    return usages.map(toMaterialUsageDto);
  }

  async addLaborEntry(projectId: string, input: CreateLaborEntryInput, actorId: string) {
    await this.getDetailOrThrow(projectId);
    const amount = round2(input.workerCount * input.units * input.ratePerUnit);
    await this.projectsRepository.createLaborEntry({
      projectId,
      category: input.category,
      description: input.description,
      workerCount: input.workerCount,
      units: input.units,
      ratePerUnit: input.ratePerUnit,
      amount,
      entryDate: input.entryDate ? new Date(input.entryDate) : undefined,
      remarks: input.remarks,
      recordedById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "PROJECT_LABOR_ENTRY_RECORDED",
      entityType: "Project",
      entityId: projectId,
      metadata: { amount },
    });
    return this.listLaborEntries(projectId);
  }

  async listLaborEntries(projectId: string) {
    await this.getDetailOrThrow(projectId);
    const entries = await this.projectsRepository.findLaborEntries(projectId);
    return entries.map(toLaborEntryDto);
  }

  async addBill(projectId: string, input: CreateBillInput, actorId: string) {
    await this.getDetailOrThrow(projectId);
    const existingBills = await this.projectsRepository.findBills(projectId);
    const previousCumulative = existingBills.at(-1)?.cumulativeAmount ?? 0;
    const currentBillAmount = round2(input.cumulativeAmount - previousCumulative);
    if (currentBillAmount < 0) {
      throw new BadRequestError("cumulativeAmount cannot be less than the previous bill's cumulative amount");
    }

    await this.projectsRepository.createBill({
      projectId,
      billNumber: input.billNumber,
      billDate: input.billDate ? new Date(input.billDate) : undefined,
      cumulativeAmount: input.cumulativeAmount,
      currentBillAmount,
      remarks: input.remarks,
      createdById: actorId,
    });
    await this.auditService.log({
      actorId,
      action: "PROJECT_BILL_CREATED",
      entityType: "Project",
      entityId: projectId,
      metadata: { billNumber: input.billNumber, currentBillAmount },
    });
    return this.listBills(projectId);
  }

  async listBills(projectId: string) {
    await this.getDetailOrThrow(projectId);
    const bills = await this.projectsRepository.findBills(projectId);
    return bills.map(toBillDto);
  }

  async updateBillStatus(
    projectId: string,
    billId: string,
    status: BillStatus,
    actorId: string,
  ) {
    const bill = await this.projectsRepository.findBillById(billId);
    if (!bill || bill.projectId !== projectId) throw new NotFoundError("Bill not found for this project");

    if (!BILL_STATUS_TRANSITIONS[bill.status].includes(status)) {
      throw new BadRequestError(`Cannot transition bill from ${bill.status} to ${status}`);
    }

    await this.projectsRepository.updateBillStatus(billId, status);
    await this.auditService.log({
      actorId,
      action: "PROJECT_BILL_STATUS_UPDATED",
      entityType: "Project",
      entityId: projectId,
      metadata: { billId, from: bill.status, to: status },
    });
    return this.listBills(projectId);
  }

  async getCosting(projectId: string): Promise<ProjectCostingDto> {
    const project = await this.getDetailOrThrow(projectId);
    const [boqEstimateTotal, purchaseOrdersTotal, laborTotal] = await Promise.all([
      this.projectsRepository.sumBoqEstimateForTender(project.tenderId),
      this.projectsRepository.sumPurchaseOrdersForTender(project.tenderId),
      this.projectsRepository.sumLaborAmount(projectId),
    ]);
    const totalActualCost = round2(purchaseOrdersTotal + laborTotal);

    return {
      budget: project.budget,
      boqEstimateTotal: round2(boqEstimateTotal),
      purchaseOrdersTotal: round2(purchaseOrdersTotal),
      laborTotal: round2(laborTotal),
      totalActualCost,
      variance: round2(project.budget - totalActualCost),
    };
  }

  async getProgress(projectId: string): Promise<ProjectProgressDto> {
    const project = await this.getDetailOrThrow(projectId);
    const totalMilestones = project.milestones.length;
    const completedMilestones = project.milestones.filter((m) => m.status === "COMPLETED").length;
    const milestoneProgressPercent = round2(
      project.milestones
        .filter((m) => m.status === "COMPLETED")
        .reduce((sum, m) => sum + m.weightPercent, 0),
    );

    const now = Date.now();
    const daysElapsed = Math.floor((now - project.startDate.getTime()) / MS_PER_DAY);
    const daysRemaining = project.endDate
      ? Math.ceil((project.endDate.getTime() - now) / MS_PER_DAY)
      : null;

    const bills = await this.projectsRepository.findBills(projectId);
    const latestBillCumulativeAmount = bills.at(-1)?.cumulativeAmount ?? 0;

    return {
      milestoneProgressPercent,
      totalMilestones,
      completedMilestones,
      daysElapsed: daysElapsed >= 0 ? daysElapsed : null,
      daysRemaining,
      latestBillCumulativeAmount,
      budget: project.budget,
    };
  }
}
