import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";
import type { FilterCondition, OrganizationSortField } from "@bmp/types";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { listAllBusinessIds } from "../../infra/prisma/business-ids.js";
import { buildPrismaFilterWhere } from "../../shared/utils/filtering.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

import { ORGANIZATION_FILTER_COLUMNS, ORGANIZATION_SORT_COLUMNS } from "./organizations.filter-columns.js";

const organizationArgs = {
  include: { _count: { select: { tenders: true } } },
} satisfies Prisma.OrganizationDefaultArgs;

export type OrganizationEntity = Prisma.OrganizationGetPayload<typeof organizationArgs>;

export interface CreateOrganizationData {
  name: string;
  type: "GOVERNMENT" | "PRIVATE";
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstNumber?: string | null;
  website?: string | null;
  notes?: string | null;
  createdById: string;
}

export type UpdateOrganizationData = Partial<Omit<CreateOrganizationData, "createdById">>;

export interface OrganizationFilters {
  search?: string;
  type?: "GOVERNMENT" | "PRIVATE";
  filters?: FilterCondition[];
  sortBy?: OrganizationSortField;
  sortDir?: "asc" | "desc";
}

export interface IOrganizationsRepository {
  findById(id: string): Promise<OrganizationEntity | null>;
  findMany(
    pagination: PaginationParams,
    filters: OrganizationFilters,
  ): Promise<{ items: OrganizationEntity[]; totalItems: number }>;
  create(data: CreateOrganizationData): Promise<OrganizationEntity>;
  update(id: string, data: UpdateOrganizationData): Promise<OrganizationEntity>;
  delete(id: string): Promise<void>;
  countTenders(organizationId: string): Promise<number>;
}

export class OrganizationsRepository implements IOrganizationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<OrganizationEntity | null> {
    return this.prisma.organization.findUnique({ where: { id }, ...organizationArgs });
  }

  async findMany(
    pagination: PaginationParams,
    filters: OrganizationFilters,
  ): Promise<{ items: OrganizationEntity[]; totalItems: number }> {
    const baseWhere: Prisma.OrganizationWhereInput = {
      type: filters.type,
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const chipWhere = buildPrismaFilterWhere(
      filters.filters ?? [],
      ORGANIZATION_FILTER_COLUMNS,
    ) as Prisma.OrganizationWhereInput;
    const where: Prisma.OrganizationWhereInput =
      Object.keys(chipWhere).length > 0 ? { AND: [baseWhere, chipWhere] } : baseWhere;

    const orderBy = filters.sortBy
      ? ORGANIZATION_SORT_COLUMNS[filters.sortBy](filters.sortDir ?? "asc")
      : ({ name: "asc" } as const);

    const [items, totalItems] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        ...organizationArgs,
        orderBy,
        ...toSkipTake(pagination),
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateOrganizationData): Promise<OrganizationEntity> {
    return this.prisma.organization.create({
      data: { id: randomUUID(), ...data },
      ...organizationArgs,
    });
  }

  update(id: string, data: UpdateOrganizationData): Promise<OrganizationEntity> {
    return this.prisma.organization.update({ where: { id }, data, ...organizationArgs });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.organization.delete({ where: { id } });
  }

  /**
   * `Organization` is intentionally global/shared across all businesses, so a single organization
   * can legitimately be referenced by tenders in multiple businesses — the delete-guard needs a
   * true cross-business total. `Tender` is a business-scoped model (see scoped-client.ts's
   * `SCOPED_MODELS`), so a single unscoped count is refused at query time; instead sum a scoped,
   * per-business count across every business.
   */
  async countTenders(organizationId: string): Promise<number> {
    const businessIds = await listAllBusinessIds(this.prisma);
    const counts = await Promise.all(
      businessIds.map((businessId) =>
        this.prisma.tender.count({ where: { clientId: organizationId, businessId } }),
      ),
    );
    return counts.reduce((sum, count) => sum + count, 0);
  }
}
