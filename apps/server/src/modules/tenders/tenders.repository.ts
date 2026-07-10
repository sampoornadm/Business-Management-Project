import { randomUUID } from "node:crypto";

import type {
  Prisma,
  PrismaClient,
  TenderAssigneeRole,
  TenderPriority,
  TenderStatus,
} from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const userSummarySelect = { id: true, firstName: true, lastName: true, email: true } as const;
const actorSummarySelect = { id: true, firstName: true, lastName: true } as const;

const tenderListArgs = {
  include: {
    client: { select: { id: true, name: true, type: true } },
    _count: { select: { assignees: true } },
  },
} satisfies Prisma.TenderDefaultArgs;

export type TenderListItem = Prisma.TenderGetPayload<typeof tenderListArgs>;

const tenderDetailArgs = {
  include: {
    client: { select: { id: true, name: true, type: true } },
    createdBy: { select: actorSummarySelect },
    assignees: {
      include: { user: { select: userSummarySelect }, assignedBy: { select: actorSummarySelect } },
      orderBy: { createdAt: "asc" },
    },
    competitors: { orderBy: { createdAt: "asc" } },
    tags: { include: { tag: true } },
  },
} satisfies Prisma.TenderDefaultArgs;

export type TenderDetail = Prisma.TenderGetPayload<typeof tenderDetailArgs>;
export type TenderAssigneeWithRelations = TenderDetail["assignees"][number];

export interface CreateTenderData {
  tenderNumber: string;
  title: string;
  department: string;
  clientId: string;
  type: string;
  category: string;
  location: string;
  state: string;
  estimatedCost: number;
  emdAmount?: number | null;
  tenderFee?: number | null;
  documentFee?: number | null;
  submissionDate: Date;
  openingDate?: Date | null;
  validityPeriodDays?: number | null;
  priority?: TenderPriority;
  description?: string | null;
  remarks?: string | null;
  dealingOfficerName?: string | null;
  dealingOfficerEmail?: string | null;
  dealingOfficerPhone?: string | null;
  businessId: string;
  createdById: string;
}

export type UpdateTenderData = Partial<Omit<CreateTenderData, "createdById">>;

export interface TenderFilters {
  businessId: string;
  search?: string;
  status?: TenderStatus;
  clientId?: string;
  department?: string;
  priority?: TenderPriority;
  assigneeUserId?: string;
  submissionDateFrom?: Date;
  submissionDateTo?: Date;
}

export interface StatusChangeData {
  status: TenderStatus;
  statusChangedAt: Date;
  winnerName?: string | null;
  winningBidAmount?: number | null;
  lossReason?: string | null;
}

export interface CreateCompetitorData {
  competitorName: string;
  bidAmount?: number | null;
  isWinningBid?: boolean;
  remarks?: string | null;
}

export type UpdateCompetitorData = Partial<CreateCompetitorData>;

export interface ITendersRepository {
  findById(id: string, businessId: string): Promise<TenderDetail | null>;
  findByTenderNumber(tenderNumber: string, businessId: string): Promise<{ id: string } | null>;
  findMany(
    pagination: PaginationParams,
    filters: TenderFilters,
  ): Promise<{ items: TenderListItem[]; totalItems: number }>;
  create(data: CreateTenderData): Promise<TenderDetail>;
  update(id: string, data: UpdateTenderData): Promise<TenderDetail>;
  updateStatus(id: string, data: StatusChangeData): Promise<TenderDetail>;
  delete(id: string): Promise<void>;

  findAssignee(tenderId: string, userId: string): Promise<{ id: string } | null>;
  addAssignee(
    tenderId: string,
    userId: string,
    role: TenderAssigneeRole,
    assignedById: string,
  ): Promise<void>;
  removeAssignee(tenderId: string, userId: string): Promise<void>;
  listAssigneeUserIds(tenderId: string): Promise<string[]>;

  findCompetitorById(id: string): Promise<{ id: string; tenderId: string } | null>;
  addCompetitor(tenderId: string, data: CreateCompetitorData): Promise<void>;
  updateCompetitor(id: string, data: UpdateCompetitorData): Promise<void>;
  deleteCompetitor(id: string): Promise<void>;

  setTags(tenderId: string, tagIds: string[]): Promise<void>;

  countByStatus(): Promise<Array<{ status: TenderStatus; count: number }>>;
  findUpcomingDeadlines(withinDays: number): Promise<TenderListItem[]>;
}

export class TendersRepository implements ITendersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, businessId: string): Promise<TenderDetail | null> {
    // findFirst (not findUnique) because `id` alone isn't the unique key we're
    // filtering by here — businessId must also match, and there's no
    // compound (id, businessId) unique constraint on Tender.
    return this.prisma.tender.findFirst({ where: { id, businessId }, ...tenderDetailArgs });
  }

  findByTenderNumber(tenderNumber: string, businessId: string): Promise<{ id: string } | null> {
    return this.prisma.tender.findFirst({ where: { tenderNumber, businessId }, select: { id: true } });
  }

  async findMany(
    pagination: PaginationParams,
    filters: TenderFilters,
  ): Promise<{ items: TenderListItem[]; totalItems: number }> {
    const where: Prisma.TenderWhereInput = {
      businessId: filters.businessId,
      status: filters.status,
      clientId: filters.clientId,
      priority: filters.priority,
      ...(filters.department ? { department: { contains: filters.department, mode: "insensitive" } } : {}),
      ...(filters.assigneeUserId ? { assignees: { some: { userId: filters.assigneeUserId } } } : {}),
      ...(filters.submissionDateFrom || filters.submissionDateTo
        ? {
            submissionDate: {
              gte: filters.submissionDateFrom,
              lte: filters.submissionDateTo,
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { title: { contains: filters.search, mode: "insensitive" } },
              { tenderNumber: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.tender.findMany({
        where,
        ...tenderListArgs,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.tender.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateTenderData): Promise<TenderDetail> {
    return this.prisma.tender.create({ data: { id: randomUUID(), ...data }, ...tenderDetailArgs });
  }

  update(id: string, data: UpdateTenderData): Promise<TenderDetail> {
    return this.prisma.tender.update({ where: { id }, data, ...tenderDetailArgs });
  }

  updateStatus(id: string, data: StatusChangeData): Promise<TenderDetail> {
    return this.prisma.tender.update({ where: { id }, data, ...tenderDetailArgs });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tender.delete({ where: { id } });
  }

  findAssignee(tenderId: string, userId: string): Promise<{ id: string } | null> {
    return this.prisma.tenderAssignee.findUnique({
      where: { tenderId_userId: { tenderId, userId } },
      select: { id: true },
    });
  }

  async addAssignee(
    tenderId: string,
    userId: string,
    role: TenderAssigneeRole,
    assignedById: string,
  ): Promise<void> {
    await this.prisma.tenderAssignee.create({
      data: { id: randomUUID(), tenderId, userId, role, assignedById },
    });
  }

  async removeAssignee(tenderId: string, userId: string): Promise<void> {
    await this.prisma.tenderAssignee.delete({ where: { tenderId_userId: { tenderId, userId } } });
  }

  async listAssigneeUserIds(tenderId: string): Promise<string[]> {
    const rows = await this.prisma.tenderAssignee.findMany({
      where: { tenderId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  findCompetitorById(id: string): Promise<{ id: string; tenderId: string } | null> {
    return this.prisma.tenderCompetitor.findUnique({
      where: { id },
      select: { id: true, tenderId: true },
    });
  }

  async addCompetitor(tenderId: string, data: CreateCompetitorData): Promise<void> {
    await this.prisma.tenderCompetitor.create({ data: { id: randomUUID(), tenderId, ...data } });
  }

  async updateCompetitor(id: string, data: UpdateCompetitorData): Promise<void> {
    await this.prisma.tenderCompetitor.update({ where: { id }, data });
  }

  async deleteCompetitor(id: string): Promise<void> {
    await this.prisma.tenderCompetitor.delete({ where: { id } });
  }

  async setTags(tenderId: string, tagIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.tenderTag.deleteMany({ where: { tenderId } }),
      this.prisma.tenderTag.createMany({
        data: tagIds.map((tagId) => ({ id: randomUUID(), tenderId, tagId })),
      }),
    ]);
  }

  async countByStatus(): Promise<Array<{ status: TenderStatus; count: number }>> {
    const rows = await this.prisma.tender.groupBy({ by: ["status"], _count: { _all: true } });
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  findUpcomingDeadlines(withinDays: number): Promise<TenderListItem[]> {
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    return this.prisma.tender.findMany({
      where: {
        submissionDate: { gte: now, lte: until },
        status: { notIn: ["WON", "LOST", "CANCELLED"] },
      },
      ...tenderListArgs,
      orderBy: { submissionDate: "asc" },
      take: 10,
    });
  }
}
