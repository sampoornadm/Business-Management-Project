import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ITendersRepository } from "../../tenders/tenders.repository.js";
import type {
  BillWithCreator,
  CreateBillData,
  CreateLaborEntryData,
  CreateMaterialUsageData,
  CreateMilestoneData,
  CreateProjectData,
  IProjectsRepository,
  LaborEntryWithRecorder,
  MaterialUsageWithRecorder,
  ProjectDetail,
  UpdateMilestoneData,
  UpdateProjectData,
} from "../projects.repository.js";
import { ProjectsService } from "../projects.service.js";

const CREATOR = { id: randomUUID(), firstName: "Pat", lastName: "ProjectManager" };

class FakeProjectsRepository implements IProjectsRepository {
  projects = new Map<string, ProjectDetail>();
  milestones = new Map<string, { id: string; projectId: string }>();
  bills = new Map<string, BillWithCreator[]>();
  labor = new Map<string, LaborEntryWithRecorder[]>();
  materials = new Map<string, MaterialUsageWithRecorder[]>();
  boqEstimate = 0;
  poTotal = 0;

  async createFromTender(data: CreateProjectData) {
    const id = randomUUID();
    this.projects.set(id, {
      id,
      tenderId: data.tenderId,
      name: data.name,
      status: "ACTIVE",
      budget: data.budget,
      startDate: data.startDate,
      endDate: data.endDate ?? null,
      actualEndDate: null,
      location: data.location ?? null,
      notes: data.notes ?? null,
      createdById: data.createdById,
      createdBy: CREATOR,
      milestones: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ProjectDetail);
    return id;
  }

  async findById(id: string, _businessId: string) {
    return this.projects.get(id) ?? null;
  }

  async findByTenderId(tenderId: string, _businessId: string) {
    const found = [...this.projects.values()].find((p) => p.tenderId === tenderId);
    return found ? { id: found.id } : null;
  }

  async findMany() {
    const items = [...this.projects.values()];
    return { items, totalItems: items.length };
  }

  async update(id: string, data: UpdateProjectData) {
    const project = this.projects.get(id);
    if (!project) throw new Error("not found");
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    Object.assign(project, defined);
  }

  async createMilestone(data: CreateMilestoneData) {
    const id = randomUUID();
    const project = this.projects.get(data.projectId);
    if (!project) throw new Error("not found");
    const milestone = {
      id,
      title: data.title,
      plannedDate: data.plannedDate ?? null,
      completedDate: null,
      status: "PENDING" as const,
      weightPercent: data.weightPercent ?? 0,
      sortOrder: data.sortOrder ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    (project.milestones as unknown[]).push(milestone);
    this.milestones.set(id, { id, projectId: data.projectId });
  }

  async findMilestoneById(id: string) {
    return this.milestones.get(id) ?? null;
  }

  async updateMilestone(id: string, data: UpdateMilestoneData) {
    const ref = this.milestones.get(id);
    if (!ref) throw new Error("not found");
    const project = this.projects.get(ref.projectId)!;
    const milestone = project.milestones.find((m) => m.id === id);
    // Prisma omits `undefined` fields from the SQL SET clause entirely, unlike
    // Object.assign — filter them out here so the fake matches real behavior.
    const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    if (milestone) Object.assign(milestone, defined);
  }

  async deleteMilestone(id: string) {
    const ref = this.milestones.get(id);
    if (!ref) return;
    const project = this.projects.get(ref.projectId)!;
    project.milestones = project.milestones.filter((m) => m.id !== id) as never;
    this.milestones.delete(id);
  }

  async createMaterialUsage(data: CreateMaterialUsageData) {
    const list = this.materials.get(data.projectId) ?? [];
    list.push({
      id: randomUUID(),
      boqItemId: data.boqItemId ?? null,
      materialName: data.materialName,
      unit: data.unit ?? null,
      quantityUsed: data.quantityUsed,
      usageDate: data.usageDate ?? new Date(),
      remarks: data.remarks ?? null,
      recordedBy: CREATOR,
      createdAt: new Date(),
    } as unknown as MaterialUsageWithRecorder);
    this.materials.set(data.projectId, list);
  }

  async findMaterialUsages(projectId: string) {
    return this.materials.get(projectId) ?? [];
  }

  async createLaborEntry(data: CreateLaborEntryData) {
    const list = this.labor.get(data.projectId) ?? [];
    list.push({
      id: randomUUID(),
      category: data.category,
      description: data.description,
      workerCount: data.workerCount,
      units: data.units,
      ratePerUnit: data.ratePerUnit,
      amount: data.amount,
      entryDate: data.entryDate ?? new Date(),
      remarks: data.remarks ?? null,
      recordedBy: CREATOR,
      createdAt: new Date(),
    } as unknown as LaborEntryWithRecorder);
    this.labor.set(data.projectId, list);
  }

  async findLaborEntries(projectId: string) {
    return this.labor.get(projectId) ?? [];
  }

  async sumLaborAmount(projectId: string) {
    return (this.labor.get(projectId) ?? []).reduce((sum, entry) => sum + entry.amount, 0);
  }

  async createBill(data: CreateBillData) {
    const list = this.bills.get(data.projectId) ?? [];
    list.push({
      id: randomUUID(),
      billNumber: data.billNumber,
      billDate: data.billDate ?? new Date(),
      cumulativeAmount: data.cumulativeAmount,
      currentBillAmount: data.currentBillAmount,
      status: "DRAFT" as const,
      remarks: data.remarks ?? null,
      createdBy: CREATOR,
      createdAt: new Date(),
    } as unknown as BillWithCreator);
    this.bills.set(data.projectId, list);
  }

  async findBills(projectId: string) {
    return this.bills.get(projectId) ?? [];
  }

  async findBillById(id: string) {
    for (const [projectId, list] of this.bills.entries()) {
      const bill = list.find((b) => b.id === id);
      if (bill) return { id: bill.id, projectId, status: bill.status };
    }
    return null;
  }

  async updateBillStatus(id: string, status: never) {
    for (const list of this.bills.values()) {
      const bill = list.find((b) => b.id === id);
      if (bill) bill.status = status;
    }
  }

  async sumBoqEstimateForTender() {
    return this.boqEstimate;
  }

  async sumPurchaseOrdersForTender() {
    return this.poTotal;
  }
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenders = new Map<string, { id: string; status: string; winningBidAmount: number | null; estimatedCost: number; title: string; location: string }>();

  async findById(id: string, _businessId: string) {
    return (this.tenders.get(id) as never) ?? null;
  }
}

describe("ProjectsService", () => {
  let repository: FakeProjectsRepository;
  let tendersRepository: FakeTendersRepository;
  let auditService: AuditService;
  let service: ProjectsService;
  const actorId = randomUUID();
  const tenderId = randomUUID();
  const businessId = randomUUID();

  beforeEach(() => {
    repository = new FakeProjectsRepository();
    tendersRepository = new FakeTendersRepository();
    tendersRepository.tenders.set(tenderId, {
      id: tenderId,
      status: "WON",
      winningBidAmount: 500000,
      estimatedCost: 480000,
      title: "Road Widening Project",
      location: "Test City",
    });
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new ProjectsService(
      repository as unknown as IProjectsRepository,
      tendersRepository as unknown as ITendersRepository,
      auditService,
    );
  });

  it("creates a project from a WON tender, defaulting budget to the winning bid", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    expect(project.name).toBe("Road Widening Project");
    expect(project.budget).toBe(500000);
  });

  it("rejects converting a tender that isn't WON", async () => {
    tendersRepository.tenders.get(tenderId)!.status = "SUBMITTED";
    await expect(
      service.createFromTender({ tenderId, startDate: new Date().toISOString() }, actorId, { businessId }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects converting the same tender twice", async () => {
    await service.createFromTender({ tenderId, startDate: new Date().toISOString() }, actorId, { businessId });
    await expect(
      service.createFromTender({ tenderId, startDate: new Date().toISOString() }, actorId, { businessId }),
    ).rejects.toThrow(ConflictError);
  });

  it("computes milestone progress from completed milestones' weight", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    const withM1 = await service.addMilestone(
      project.id,
      { title: "Foundation", weightPercent: 40 },
      actorId,
      businessId,
    );
    const withM2 = await service.addMilestone(
      project.id,
      { title: "Structure", weightPercent: 60 },
      actorId,
      businessId,
    );
    const m1 = withM2.milestones.find((m) => m.title === "Foundation")!;

    await service.updateMilestone(project.id, m1.id, { status: "COMPLETED" }, actorId, businessId);
    const progress = await service.getProgress(project.id, businessId);
    expect(progress.milestoneProgressPercent).toBe(40);
    expect(progress.completedMilestones).toBe(1);
    expect(progress.totalMilestones).toBe(2);
    expect(withM1.milestones).toHaveLength(1);
  });

  it("computes labor entry amount server-side", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    const entries = await service.addLaborEntry(
      project.id,
      { category: "SKILLED", description: "Masons", workerCount: 5, units: 8, ratePerUnit: 50 },
      actorId,
      businessId,
    );
    expect(entries[0]!.amount).toBe(2000);
  });

  it("computes the first bill's currentBillAmount as the full cumulative amount", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    const bills = await service.addBill(
      project.id,
      { billNumber: "RA-1", cumulativeAmount: 100000 },
      actorId,
      businessId,
    );
    expect(bills[0]!.currentBillAmount).toBe(100000);
  });

  it("computes the second bill's currentBillAmount as the delta from the previous cumulative", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    await service.addBill(project.id, { billNumber: "RA-1", cumulativeAmount: 100000 }, actorId, businessId);
    const bills = await service.addBill(
      project.id,
      { billNumber: "RA-2", cumulativeAmount: 150000 },
      actorId,
      businessId,
    );
    expect(bills[1]!.currentBillAmount).toBe(50000);
  });

  it("rejects a bill with a cumulative amount lower than the previous bill", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    await service.addBill(project.id, { billNumber: "RA-1", cumulativeAmount: 100000 }, actorId, businessId);
    await expect(
      service.addBill(project.id, { billNumber: "RA-2", cumulativeAmount: 90000 }, actorId, businessId),
    ).rejects.toThrow(BadRequestError);
  });

  it("rejects skipping a bill status transition", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    const bills = await service.addBill(
      project.id,
      { billNumber: "RA-1", cumulativeAmount: 100000 },
      actorId,
      businessId,
    );
    await expect(
      service.updateBillStatus(project.id, bills[0]!.id, "APPROVED", actorId, businessId),
    ).rejects.toThrow(BadRequestError);
  });

  it("allows a valid bill status transition", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    const bills = await service.addBill(
      project.id,
      { billNumber: "RA-1", cumulativeAmount: 100000 },
      actorId,
      businessId,
    );
    const updated = await service.updateBillStatus(project.id, bills[0]!.id, "SUBMITTED", actorId, businessId);
    expect(updated[0]!.status).toBe("SUBMITTED");
  });

  it("computes project costing from BOQ estimate, PO totals, and labor totals", async () => {
    const project = await service.createFromTender(
      { tenderId, startDate: new Date().toISOString() },
      actorId,
      { businessId },
    );
    repository.boqEstimate = 480000;
    repository.poTotal = 200000;
    await service.addLaborEntry(
      project.id,
      { category: "UNSKILLED", description: "Laborers", workerCount: 10, units: 5, ratePerUnit: 40 },
      actorId,
      businessId,
    );

    const costing = await service.getCosting(project.id, businessId);
    expect(costing.boqEstimateTotal).toBe(480000);
    expect(costing.purchaseOrdersTotal).toBe(200000);
    expect(costing.laborTotal).toBe(2000);
    expect(costing.totalActualCost).toBe(202000);
    expect(costing.variance).toBe(500000 - 202000);
  });

  it("throws for an unknown project id", async () => {
    await expect(service.getById(randomUUID(), businessId)).rejects.toThrow(NotFoundError);
  });
});
