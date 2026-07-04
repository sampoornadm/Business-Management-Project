import { randomUUID } from "node:crypto";

import type {
  BillStatus,
  LaborCategory,
  MilestoneStatus,
  Prisma,
  PrismaClient,
  ProjectStatus,
} from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const creatorSelect = { id: true, firstName: true, lastName: true } as const;

const projectDetailArgs = {
  include: {
    createdBy: { select: creatorSelect },
    milestones: { orderBy: { sortOrder: "asc" } },
  },
} satisfies Prisma.ProjectDefaultArgs;

export type ProjectDetail = Prisma.ProjectGetPayload<typeof projectDetailArgs>;

export interface CreateProjectData {
  tenderId: string;
  name: string;
  budget: number;
  startDate: Date;
  endDate?: Date | null;
  location?: string | null;
  notes?: string | null;
  createdById: string;
}

export type UpdateProjectData = Partial<
  Omit<CreateProjectData, "tenderId" | "createdById"> & { status: ProjectStatus; actualEndDate: Date | null }
>;

export interface ProjectFilters {
  status?: ProjectStatus;
}

export interface CreateMilestoneData {
  projectId: string;
  title: string;
  plannedDate?: Date | null;
  weightPercent?: number;
  sortOrder?: number;
}

export type UpdateMilestoneData = Partial<{
  title: string;
  plannedDate: Date | null;
  completedDate: Date | null;
  status: MilestoneStatus;
  weightPercent: number;
  sortOrder: number;
}>;

export interface CreateMaterialUsageData {
  projectId: string;
  boqItemId?: string | null;
  materialName: string;
  unit?: string | null;
  quantityUsed: number;
  usageDate?: Date;
  remarks?: string | null;
  recordedById: string;
}

const materialUsageArgs = {
  include: { recordedBy: { select: creatorSelect } },
} satisfies Prisma.ProjectMaterialUsageDefaultArgs;
export type MaterialUsageWithRecorder = Prisma.ProjectMaterialUsageGetPayload<typeof materialUsageArgs>;

export interface CreateLaborEntryData {
  projectId: string;
  category: LaborCategory;
  description: string;
  workerCount: number;
  units: number;
  ratePerUnit: number;
  amount: number;
  entryDate?: Date;
  remarks?: string | null;
  recordedById: string;
}

const laborEntryArgs = {
  include: { recordedBy: { select: creatorSelect } },
} satisfies Prisma.ProjectLaborEntryDefaultArgs;
export type LaborEntryWithRecorder = Prisma.ProjectLaborEntryGetPayload<typeof laborEntryArgs>;

export interface CreateBillData {
  projectId: string;
  billNumber: string;
  billDate?: Date;
  cumulativeAmount: number;
  currentBillAmount: number;
  remarks?: string | null;
  createdById: string;
}

const billArgs = {
  include: { createdBy: { select: creatorSelect } },
} satisfies Prisma.ProjectBillDefaultArgs;
export type BillWithCreator = Prisma.ProjectBillGetPayload<typeof billArgs>;

export interface IProjectsRepository {
  createFromTender(data: CreateProjectData): Promise<string>;
  findById(id: string): Promise<ProjectDetail | null>;
  findByTenderId(tenderId: string): Promise<{ id: string } | null>;
  findMany(
    pagination: PaginationParams,
    filters: ProjectFilters,
  ): Promise<{ items: ProjectDetail[]; totalItems: number }>;
  update(id: string, data: UpdateProjectData): Promise<void>;

  createMilestone(data: CreateMilestoneData): Promise<void>;
  findMilestoneById(id: string): Promise<{ id: string; projectId: string } | null>;
  updateMilestone(id: string, data: UpdateMilestoneData): Promise<void>;
  deleteMilestone(id: string): Promise<void>;

  createMaterialUsage(data: CreateMaterialUsageData): Promise<void>;
  findMaterialUsages(projectId: string): Promise<MaterialUsageWithRecorder[]>;

  createLaborEntry(data: CreateLaborEntryData): Promise<void>;
  findLaborEntries(projectId: string): Promise<LaborEntryWithRecorder[]>;
  sumLaborAmount(projectId: string): Promise<number>;

  createBill(data: CreateBillData): Promise<void>;
  findBills(projectId: string): Promise<BillWithCreator[]>;
  findBillById(id: string): Promise<{ id: string; projectId: string; status: BillStatus } | null>;
  updateBillStatus(id: string, status: BillStatus): Promise<void>;

  sumBoqEstimateForTender(tenderId: string): Promise<number>;
  sumPurchaseOrdersForTender(tenderId: string): Promise<number>;
}

export class ProjectsRepository implements IProjectsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createFromTender(data: CreateProjectData): Promise<string> {
    const id = randomUUID();
    await this.prisma.project.create({ data: { id, ...data } });
    return id;
  }

  findById(id: string): Promise<ProjectDetail | null> {
    return this.prisma.project.findUnique({ where: { id }, ...projectDetailArgs });
  }

  findByTenderId(tenderId: string): Promise<{ id: string } | null> {
    return this.prisma.project.findUnique({ where: { tenderId }, select: { id: true } });
  }

  async findMany(
    pagination: PaginationParams,
    filters: ProjectFilters,
  ): Promise<{ items: ProjectDetail[]; totalItems: number }> {
    const where: Prisma.ProjectWhereInput = { status: filters.status };
    const [items, totalItems] = await Promise.all([
      this.prisma.project.findMany({
        where,
        ...projectDetailArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, totalItems };
  }

  async update(id: string, data: UpdateProjectData): Promise<void> {
    await this.prisma.project.update({ where: { id }, data });
  }

  async createMilestone(data: CreateMilestoneData): Promise<void> {
    await this.prisma.projectMilestone.create({ data: { id: randomUUID(), ...data } });
  }

  findMilestoneById(id: string): Promise<{ id: string; projectId: string } | null> {
    return this.prisma.projectMilestone.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
  }

  async updateMilestone(id: string, data: UpdateMilestoneData): Promise<void> {
    await this.prisma.projectMilestone.update({ where: { id }, data });
  }

  async deleteMilestone(id: string): Promise<void> {
    await this.prisma.projectMilestone.delete({ where: { id } });
  }

  async createMaterialUsage(data: CreateMaterialUsageData): Promise<void> {
    await this.prisma.projectMaterialUsage.create({ data: { id: randomUUID(), ...data } });
  }

  findMaterialUsages(projectId: string): Promise<MaterialUsageWithRecorder[]> {
    return this.prisma.projectMaterialUsage.findMany({
      where: { projectId },
      orderBy: { usageDate: "desc" },
      ...materialUsageArgs,
    });
  }

  async createLaborEntry(data: CreateLaborEntryData): Promise<void> {
    await this.prisma.projectLaborEntry.create({ data: { id: randomUUID(), ...data } });
  }

  findLaborEntries(projectId: string): Promise<LaborEntryWithRecorder[]> {
    return this.prisma.projectLaborEntry.findMany({
      where: { projectId },
      orderBy: { entryDate: "desc" },
      ...laborEntryArgs,
    });
  }

  async sumLaborAmount(projectId: string): Promise<number> {
    const result = await this.prisma.projectLaborEntry.aggregate({
      where: { projectId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async createBill(data: CreateBillData): Promise<void> {
    await this.prisma.projectBill.create({ data: { id: randomUUID(), ...data } });
  }

  findBills(projectId: string): Promise<BillWithCreator[]> {
    return this.prisma.projectBill.findMany({
      where: { projectId },
      orderBy: { billDate: "asc" },
      ...billArgs,
    });
  }

  findBillById(id: string): Promise<{ id: string; projectId: string; status: BillStatus } | null> {
    return this.prisma.projectBill.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true },
    });
  }

  async updateBillStatus(id: string, status: BillStatus): Promise<void> {
    await this.prisma.projectBill.update({ where: { id }, data: { status } });
  }

  async sumBoqEstimateForTender(tenderId: string): Promise<number> {
    const result = await this.prisma.boqItem.aggregate({
      where: { boq: { tenderId, isCurrent: true } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async sumPurchaseOrdersForTender(tenderId: string): Promise<number> {
    const result = await this.prisma.purchaseOrderItem.aggregate({
      where: {
        purchaseOrder: { tenderId, status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] } },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }
}
