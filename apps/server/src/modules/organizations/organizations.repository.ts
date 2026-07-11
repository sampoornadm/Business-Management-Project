import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { listAllBusinessIds } from "../../infra/prisma/business-ids.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const organizationWithContacts = {
  include: { contacts: { orderBy: { isPrimary: "desc" } }, _count: { select: { tenders: true } } },
} satisfies Prisma.OrganizationDefaultArgs;

export type OrganizationWithContacts = Prisma.OrganizationGetPayload<typeof organizationWithContacts>;

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
}

export interface CreateContactData {
  organizationId: string;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export type UpdateContactData = Partial<Omit<CreateContactData, "organizationId">>;

export interface IOrganizationsRepository {
  findById(id: string): Promise<OrganizationWithContacts | null>;
  findMany(
    pagination: PaginationParams,
    filters: OrganizationFilters,
  ): Promise<{ items: OrganizationWithContacts[]; totalItems: number }>;
  create(data: CreateOrganizationData): Promise<OrganizationWithContacts>;
  update(id: string, data: UpdateOrganizationData): Promise<OrganizationWithContacts>;
  delete(id: string): Promise<void>;
  countTenders(organizationId: string): Promise<number>;
  createContact(data: CreateContactData): Promise<void>;
  updateContact(id: string, data: UpdateContactData): Promise<void>;
  deleteContact(id: string): Promise<void>;
}

export class OrganizationsRepository implements IOrganizationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<OrganizationWithContacts | null> {
    return this.prisma.organization.findUnique({ where: { id }, ...organizationWithContacts });
  }

  async findMany(
    pagination: PaginationParams,
    filters: OrganizationFilters,
  ): Promise<{ items: OrganizationWithContacts[]; totalItems: number }> {
    const where: Prisma.OrganizationWhereInput = {
      type: filters.type,
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        ...organizationWithContacts,
        orderBy: { name: "asc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateOrganizationData): Promise<OrganizationWithContacts> {
    return this.prisma.organization.create({
      data: { id: randomUUID(), ...data },
      ...organizationWithContacts,
    });
  }

  update(id: string, data: UpdateOrganizationData): Promise<OrganizationWithContacts> {
    return this.prisma.organization.update({ where: { id }, data, ...organizationWithContacts });
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

  async createContact(data: CreateContactData): Promise<void> {
    await this.prisma.organizationContact.create({ data: { id: randomUUID(), ...data } });
  }

  async updateContact(id: string, data: UpdateContactData): Promise<void> {
    await this.prisma.organizationContact.update({ where: { id }, data });
  }

  async deleteContact(id: string): Promise<void> {
    await this.prisma.organizationContact.delete({ where: { id } });
  }
}
