import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

function userWithRoleArgs(businessId: string) {
  return {
    include: {
      avatarAttachment: true,
      userBusinesses: { where: { businessId }, include: { role: true } },
    },
  } satisfies Prisma.UserDefaultArgs;
}

export type UserWithRole = Prisma.UserGetPayload<ReturnType<typeof userWithRoleArgs>>;

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  businessId: string;
  roleId: string;
  passwordHash: string;
  createdById?: string | null;
  isEmailVerified?: boolean;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  isActive?: boolean;
}

export interface UserFilters {
  businessId: string;
  search?: string;
  roleId?: string;
  isActive?: boolean;
}

export interface IUsersRepository {
  findById(id: string, businessId: string): Promise<UserWithRole | null>;
  findByEmail(email: string, businessId: string): Promise<UserWithRole | null>;
  findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }>;
  create(data: CreateUserData): Promise<UserWithRole>;
  update(id: string, data: UpdateUserData): Promise<UserWithRole>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void>;
  assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole>;
  updateLastLoginAt(id: string): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  countTotal(businessId: string): Promise<number>;
}

export class UsersRepository implements IUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithRoleArgs(businessId) });
  }

  findByEmail(email: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithRoleArgs(businessId) });
  }

  async findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }> {
    const where: Prisma.UserWhereInput = {
      userBusinesses: {
        some: {
          businessId: filters.businessId,
          ...(filters.roleId ? { roleId: filters.roleId } : {}),
        },
      },
      isActive: filters.isActive,
      ...(filters.search
        ? {
            OR: [
              { email: { contains: filters.search, mode: "insensitive" } },
              { firstName: { contains: filters.search, mode: "insensitive" } },
              { lastName: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...userWithRoleArgs(filters.businessId),
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalItems };
  }

  async create(data: CreateUserData): Promise<UserWithRole> {
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        passwordHash: data.passwordHash,
        createdById: data.createdById,
        isEmailVerified: data.isEmailVerified ?? false,
        userBusinesses: {
          create: { businessId: data.businessId, roleId: data.roleId },
        },
      },
    });
    return this.findById(user.id, data.businessId) as Promise<UserWithRole>;
  }

  update(id: string, data: UpdateUserData): Promise<UserWithRole> {
    // update() doesn't change role/business, so any existing membership's businessId works
    // for the returned include — callers only read name/contact fields off the result.
    return this.prisma.user
      .update({ where: { id }, data })
      .then(async (updated) => {
        const membership = await this.prisma.userBusiness.findFirst({ where: { userId: id } });
        return this.findById(updated.id, membership!.businessId) as Promise<UserWithRole>;
      });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { avatarAttachmentId } });
  }

  async assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole> {
    await this.prisma.userBusiness.upsert({
      where: { userId_businessId: { userId: id, businessId } },
      update: { roleId },
      create: { userId: id, businessId, roleId },
    });
    return this.findById(id, businessId) as Promise<UserWithRole>;
  }

  async updateLastLoginAt(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
  }

  countTotal(businessId: string): Promise<number> {
    return this.prisma.user.count({ where: { userBusinesses: { some: { businessId } } } });
  }
}
