import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const businessWithContacts = {
  include: { contacts: { orderBy: { isPrimary: "desc" } }, _count: { select: { tenders: true } } },
} satisfies Prisma.BusinessDefaultArgs;

export type BusinessWithContacts = Prisma.BusinessGetPayload<typeof businessWithContacts>;

export interface CreateBusinessData {
  name: string;
  code: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstNumber?: string | null;
  udyamRegistrationNumber?: string | null;
  msmeCategory?: string | null;
  panNumber?: string | null;
  website?: string | null;
  notes?: string | null;
}

export type UpdateBusinessData = Partial<CreateBusinessData> & { isActive?: boolean };

export interface BusinessFilters {
  search?: string;
  isActive?: boolean;
}

export interface CreateContactData {
  businessId: string;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export type UpdateContactData = Partial<Omit<CreateContactData, "businessId">>;

export interface MemberWithRole {
  userId: string;
  businessId: string;
  roleId: string;
  roleName: string;
  userEmail: string;
  userFirstName: string;
  userLastName: string;
}

export interface IBusinessesRepository {
  findById(id: string): Promise<BusinessWithContacts | null>;
  findMany(
    pagination: PaginationParams,
    filters: BusinessFilters,
  ): Promise<{ items: BusinessWithContacts[]; totalItems: number }>;
  create(data: CreateBusinessData): Promise<BusinessWithContacts>;
  update(id: string, data: UpdateBusinessData): Promise<BusinessWithContacts>;
  delete(id: string): Promise<void>;
  countTenders(id: string): Promise<number>;
  createContact(data: CreateContactData): Promise<void>;
  updateContact(id: string, data: UpdateContactData): Promise<void>;
  deleteContact(id: string): Promise<void>;
  findContactById(id: string): Promise<{ businessId: string } | null>;
  addMember(businessId: string, userId: string, roleId: string): Promise<void>;
  updateMemberRole(businessId: string, userId: string, roleId: string): Promise<void>;
  removeMember(businessId: string, userId: string): Promise<void>;
  listMembers(businessId: string): Promise<MemberWithRole[]>;
  findMembership(userId: string, businessId: string): Promise<{ roleId: string } | null>;
  listUserBusinesses(
    userId: string,
  ): Promise<Array<{ businessId: string; businessName: string; businessCode: string }>>;
}

export class BusinessesRepository implements IBusinessesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<BusinessWithContacts | null> {
    return this.prisma.business.findUnique({ where: { id }, ...businessWithContacts });
  }

  async findMany(
    pagination: PaginationParams,
    filters: BusinessFilters,
  ): Promise<{ items: BusinessWithContacts[]; totalItems: number }> {
    const where: Prisma.BusinessWhereInput = {
      isActive: filters.isActive,
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.business.findMany({
        where,
        ...businessWithContacts,
        orderBy: { name: "asc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.business.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateBusinessData): Promise<BusinessWithContacts> {
    return this.prisma.business.create({
      data: { id: randomUUID(), ...data },
      ...businessWithContacts,
    });
  }

  update(id: string, data: UpdateBusinessData): Promise<BusinessWithContacts> {
    return this.prisma.business.update({ where: { id }, data, ...businessWithContacts });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.business.delete({ where: { id } });
  }

  countTenders(id: string): Promise<number> {
    return this.prisma.tender.count({ where: { businessId: id } });
  }

  async createContact(data: CreateContactData): Promise<void> {
    await this.prisma.businessContact.create({ data: { id: randomUUID(), ...data } });
  }

  async updateContact(id: string, data: UpdateContactData): Promise<void> {
    await this.prisma.businessContact.update({ where: { id }, data });
  }

  async deleteContact(id: string): Promise<void> {
    await this.prisma.businessContact.delete({ where: { id } });
  }

  findContactById(id: string): Promise<{ businessId: string } | null> {
    return this.prisma.businessContact.findUnique({ where: { id }, select: { businessId: true } });
  }

  async addMember(businessId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.userBusiness.create({ data: { userId, businessId, roleId } });
  }

  async updateMemberRole(businessId: string, userId: string, roleId: string): Promise<void> {
    await this.prisma.userBusiness.update({
      where: { userId_businessId: { userId, businessId } },
      data: { roleId },
    });
  }

  async removeMember(businessId: string, userId: string): Promise<void> {
    await this.prisma.userBusiness.delete({ where: { userId_businessId: { userId, businessId } } });
  }

  async listMembers(businessId: string): Promise<MemberWithRole[]> {
    const rows = await this.prisma.userBusiness.findMany({
      where: { businessId },
      include: { user: true, role: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      businessId: row.businessId,
      roleId: row.roleId,
      roleName: row.role.name,
      userEmail: row.user.email,
      userFirstName: row.user.firstName,
      userLastName: row.user.lastName,
    }));
  }

  findMembership(userId: string, businessId: string): Promise<{ roleId: string } | null> {
    return this.prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId, businessId } },
      select: { roleId: true },
    });
  }

  async listUserBusinesses(
    userId: string,
  ): Promise<Array<{ businessId: string; businessName: string; businessCode: string }>> {
    const rows = await this.prisma.userBusiness.findMany({
      where: { userId },
      include: { business: true },
    });
    return rows.map((row) => ({
      businessId: row.businessId,
      businessName: row.business.name,
      businessCode: row.business.code,
    }));
  }
}
